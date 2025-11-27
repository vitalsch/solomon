from __future__ import annotations

import os
import json
import re
from typing import Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, validator
from typing import Any, Dict, List

from .repository import WealthRepository
from .services import run_scenario_simulation

app = FastAPI(title="Wealth Planner API", version="0.1.0")

allowed_origins = os.getenv("CORS_ALLOW_ORIGINS", "*")
if allowed_origins == "*":
    origins = ["*"]
else:
    origins = [origin.strip() for origin in allowed_origins.split(",")]

print(f"[CORS] allow_origins={origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)

repo = WealthRepository()
auth_scheme = HTTPBearer()

try:
    from openai import OpenAI
except ImportError:  # pragma: no cover - only if dependency missing
    OpenAI = None  # type: ignore

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
_cached_openai_client = None


def get_openai_client():
    """
    Build the OpenAI client lazily to avoid import-time crashes (e.g. httpx proxy signature mismatch).
    Returns None if no key is set or if the client cannot be constructed.
    """
    global _cached_openai_client
    if _cached_openai_client is not None:
        return _cached_openai_client
    if not (OpenAI and OPENAI_API_KEY):
        return None
    try:
        _cached_openai_client = OpenAI(api_key=OPENAI_API_KEY)
    except Exception:
        _cached_openai_client = None
    return _cached_openai_client


class UserCreate(BaseModel):
    username: str
    password: str
    name: Optional[str] = None
    email: Optional[str] = None


class UserLogin(BaseModel):
    username: str
    password: str


class ScenarioCreate(BaseModel):
    name: str
    description: Optional[str] = None
    start_year: int = Field(..., ge=1900)
    start_month: int = Field(..., ge=1, le=12)
    end_year: int = Field(..., ge=1900)
    end_month: int = Field(..., ge=1, le=12)
    inflation_rate: Optional[float] = Field(None, description="Annual inflation (fraction, e.g. 0.02)")
    income_tax_rate: Optional[float] = Field(None, description="Income tax rate (fraction)")
    wealth_tax_rate: Optional[float] = Field(None, description="Wealth tax rate (fraction)")

    @validator("end_year")
    def validate_years(cls, v, values):
        if "start_year" in values and v < values["start_year"]:
            raise ValueError("end_year must be after start_year")
        return v


class ScenarioUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    start_year: Optional[int] = None
    start_month: Optional[int] = None
    end_year: Optional[int] = None
    end_month: Optional[int] = None
    inflation_rate: Optional[float] = None
    income_tax_rate: Optional[float] = None
    wealth_tax_rate: Optional[float] = None


class AssetCreate(BaseModel):
    name: str
    annual_growth_rate: float = 0.0
    initial_balance: float = 0.0
    asset_type: Literal["generic", "real_estate", "bank_account", "mortgage"] = "generic"
    start_year: Optional[int] = None
    start_month: Optional[int] = None
    end_year: Optional[int] = None
    end_month: Optional[int] = None


class AssetUpdate(BaseModel):
    name: Optional[str] = None
    annual_growth_rate: Optional[float] = None
    initial_balance: Optional[float] = None
    asset_type: Optional[Literal["generic", "real_estate", "bank_account", "mortgage"]] = None
    start_year: Optional[int] = None
    start_month: Optional[int] = None
    end_year: Optional[int] = None
    end_month: Optional[int] = None


class TransactionCreate(BaseModel):
    asset_id: str
    name: str
    amount: float = 0.0
    type: Literal["one_time", "regular", "mortgage_interest"] = "one_time"
    start_year: int
    start_month: int
    end_year: Optional[int] = None
    end_month: Optional[int] = None
    frequency: Optional[int] = None
    annual_growth_rate: float = 0.0
    counter_asset_id: Optional[str] = None
    double_entry: bool = False
    mortgage_asset_id: Optional[str] = None
    annual_interest_rate: Optional[float] = None
    taxable: bool = False
    taxable_amount: Optional[float] = None

    @validator("frequency", always=True)
    def validate_frequency(cls, v, values):
        if values.get("type") in {"regular", "mortgage_interest"} and not v:
            raise ValueError("frequency is required for this transaction type")
        return v

    @validator("counter_asset_id", always=True)
    def validate_counter_asset(cls, v, values):
        if values.get("double_entry") and not v:
            raise ValueError("counter_asset_id is required for double_entry transactions")
        return v

    @validator("mortgage_asset_id", always=True)
    def validate_mortgage(cls, v, values):
        if values.get("type") == "mortgage_interest" and not v:
            raise ValueError("mortgage_asset_id is required for mortgage_interest transactions")
        return v


class TransactionUpdate(BaseModel):
    asset_id: Optional[str] = None
    name: Optional[str] = None
    amount: Optional[float] = None
    type: Optional[Literal["one_time", "regular", "mortgage_interest"]] = None
    start_year: Optional[int] = None
    start_month: Optional[int] = None
    end_year: Optional[int] = None
    end_month: Optional[int] = None
    frequency: Optional[int] = None
    annual_growth_rate: Optional[float] = None
    counter_asset_id: Optional[str] = None
    mortgage_asset_id: Optional[str] = None
    annual_interest_rate: Optional[float] = None
    taxable: Optional[bool] = None
    taxable_amount: Optional[float] = None


class AssistantMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class AssistantChatRequest(BaseModel):
    messages: List[AssistantMessage]
    context: Optional[Dict[str, Any]] = None


class AssistantChatResponse(BaseModel):
    messages: List[AssistantMessage]
    plan: Optional[Dict[str, Any]] = None
    reply: Optional[str] = None


class AssistantApplyRequest(BaseModel):
    plan: Dict[str, Any]


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(auth_scheme)):
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    user = repo.get_user_by_token(credentials.credentials)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    return user


@app.post("/auth/register")
def register(user: UserCreate):
    try:
        created = repo.create_user(user.username, user.password, user.name, user.email)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    token = repo.issue_auth_token(created["id"])
    return {"user": created, "token": token}


@app.post("/auth/login")
def login(user: UserLogin):
    auth_user = repo.authenticate_user(user.username, user.password)
    if not auth_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = repo.issue_auth_token(auth_user["id"])
    safe_user = repo.get_user(auth_user["id"])
    return {"user": safe_user, "token": token}


@app.get("/me")
def read_me(current_user=Depends(get_current_user)):
    return current_user


@app.delete("/me")
def delete_me(current_user=Depends(get_current_user)):
    deleted = repo.delete_user(current_user["id"])
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return {"status": "deleted"}


@app.post("/scenarios")
def create_scenario(payload: ScenarioCreate, current_user=Depends(get_current_user)):
    return repo.create_scenario(
        current_user["id"],
        payload.name,
        payload.start_year,
        payload.start_month,
        payload.end_year,
        payload.end_month,
        payload.description,
        payload.inflation_rate,
        payload.income_tax_rate,
        payload.wealth_tax_rate,
    )


@app.get("/users/{user_id}/scenarios")
def list_user_scenarios(user_id: str, current_user=Depends(get_current_user)):
    if user_id != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view other users")
    return repo.list_scenarios_for_user(current_user["id"])


@app.get("/scenarios")
def list_my_scenarios(current_user=Depends(get_current_user)):
    return repo.list_scenarios_for_user(current_user["id"])


@app.get("/scenarios/{scenario_id}")
def get_scenario(scenario_id: str, current_user=Depends(get_current_user)):
    scenario = repo.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if scenario["user_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to access this scenario")
    return scenario


@app.patch("/scenarios/{scenario_id}")
def update_scenario(scenario_id: str, payload: ScenarioUpdate, current_user=Depends(get_current_user)):
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates supplied")
    scenario = repo.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if scenario["user_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to modify this scenario")
    scenario = repo.update_scenario(scenario_id, updates)
    return scenario


@app.delete("/scenarios/{scenario_id}")
def delete_scenario(scenario_id: str, current_user=Depends(get_current_user)):
    scenario = repo.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if scenario["user_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to delete this scenario")
    deleted = repo.delete_scenario(scenario_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return {"status": "deleted"}


@app.post("/scenarios/{scenario_id}/assets")
def create_asset(scenario_id: str, payload: AssetCreate, current_user=Depends(get_current_user)):
    scenario = repo.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if scenario["user_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to modify this scenario")
    return repo.add_asset(
        scenario_id,
        payload.name,
        payload.annual_growth_rate,
        payload.initial_balance,
        payload.asset_type,
        payload.start_year,
        payload.start_month,
        payload.end_year,
        payload.end_month,
    )


@app.get("/scenarios/{scenario_id}/assets")
def list_assets(scenario_id: str, current_user=Depends(get_current_user)):
    scenario = repo.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if scenario["user_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this scenario")
    return repo.list_assets_for_scenario(scenario_id)


@app.patch("/assets/{asset_id}")
def update_asset(asset_id: str, payload: AssetUpdate, current_user=Depends(get_current_user)):
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates supplied")
    asset = repo.get_asset(asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    scenario = repo.get_scenario(asset["scenario_id"])
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if scenario["user_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to modify this asset")
    asset = repo.update_asset(asset_id, updates)
    return asset


@app.delete("/assets/{asset_id}")
def delete_asset(asset_id: str, current_user=Depends(get_current_user)):
    asset = repo.get_asset(asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    scenario = repo.get_scenario(asset["scenario_id"])
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if scenario["user_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to delete this asset")
    deleted = repo.delete_asset(asset_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"status": "deleted"}


@app.post("/scenarios/{scenario_id}/transactions")
def create_transaction(scenario_id: str, payload: TransactionCreate, current_user=Depends(get_current_user)):
    scenario = repo.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if scenario["user_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to modify this scenario")
    asset = repo.get_asset(payload.asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    if asset["scenario_id"] != scenario["id"]:
        raise HTTPException(status_code=400, detail="Asset does not belong to scenario")

    if payload.double_entry:
        if not payload.counter_asset_id:
            raise HTTPException(
                status_code=400, detail="counter_asset_id required for double entry transaction"
            )
        if payload.counter_asset_id == payload.asset_id:
            raise HTTPException(
                status_code=400, detail="counter_asset_id must be different from asset_id"
            )
        counter_asset = repo.get_asset(payload.counter_asset_id)
        if not counter_asset:
            raise HTTPException(status_code=404, detail="Counter asset not found")
        if counter_asset["scenario_id"] != scenario["id"]:
            raise HTTPException(status_code=400, detail="Counter asset not part of scenario")

        debit_tx, credit_tx = repo.add_linked_transactions(
            scenario_id,
            payload.asset_id,
            payload.counter_asset_id,
            payload.name,
            payload.amount,
            payload.type,
            payload.start_year,
            payload.start_month,
            payload.end_year or payload.start_year,
            payload.end_month or payload.start_month,
            payload.frequency,
            payload.annual_growth_rate,
        )
        debit_tx["linked_transaction"] = credit_tx
        return debit_tx

    if payload.type == "mortgage_interest":
        if payload.double_entry:
            raise HTTPException(status_code=400, detail="double_entry not supported for mortgage_interest")
        mortgage_asset = repo.get_asset(payload.mortgage_asset_id)
        if not mortgage_asset:
            raise HTTPException(status_code=404, detail="Mortgage asset not found")
        if mortgage_asset["scenario_id"] != scenario["id"]:
            raise HTTPException(status_code=400, detail="Mortgage asset not part of scenario")
        if mortgage_asset.get("asset_type") != "mortgage":
            raise HTTPException(status_code=400, detail="mortgage_asset_id must reference a mortgage asset")
        annual_interest_rate = payload.annual_interest_rate
        if annual_interest_rate is None:
            annual_interest_rate = payload.annual_growth_rate
        if annual_interest_rate is None:
            raise HTTPException(status_code=400, detail="annual_interest_rate is required")

        return repo.add_transaction(
            scenario_id,
            payload.asset_id,
            payload.name,
            0.0,
            payload.type,
            payload.start_year,
            payload.start_month,
            payload.end_year or payload.start_year,
            payload.end_month or payload.start_month,
            payload.frequency,
            payload.annual_growth_rate,
            None,
            None,
            False,
            payload.mortgage_asset_id,
            annual_interest_rate,
            payload.taxable,
            payload.taxable_amount if payload.taxable_amount is not None else None,
        )

    return repo.add_transaction(
        scenario_id,
        payload.asset_id,
        payload.name,
        payload.amount,
        payload.type,
        payload.start_year,
        payload.start_month,
        payload.end_year or payload.start_year,
        payload.end_month or payload.start_month,
        payload.frequency,
        payload.annual_growth_rate,
        payload.counter_asset_id,
        None,
        payload.double_entry,
        None,
        None,
        payload.taxable,
        payload.taxable_amount if payload.taxable_amount is not None else payload.amount if payload.taxable else None,
    )


@app.get("/scenarios/{scenario_id}/transactions")
def list_transactions(scenario_id: str, current_user=Depends(get_current_user)):
    scenario = repo.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if scenario["user_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this scenario")
    return repo.list_transactions_for_scenario(scenario_id)


@app.patch("/transactions/{transaction_id}")
def update_transaction(transaction_id: str, payload: TransactionUpdate, current_user=Depends(get_current_user)):
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates supplied")
    transaction = repo.get_transaction(transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    scenario = repo.get_scenario(transaction["scenario_id"])
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if scenario["user_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to modify this transaction")
    transaction = repo.update_transaction(transaction_id, updates)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return transaction


@app.delete("/transactions/{transaction_id}")
def delete_transaction(transaction_id: str, current_user=Depends(get_current_user)):
    transaction = repo.get_transaction(transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    scenario = repo.get_scenario(transaction["scenario_id"])
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if scenario["user_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to delete this transaction")
    deleted = repo.delete_transaction(transaction_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return {"status": "deleted"}


@app.post("/scenarios/{scenario_id}/simulate")
def simulate_scenario(scenario_id: str, current_user=Depends(get_current_user)):
    scenario = repo.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if scenario["user_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this scenario")
    try:
        return run_scenario_simulation(scenario_id, repo)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _ensure_scenario_access(scenario_id: str, current_user):
    scenario = repo.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if scenario["user_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to access this scenario")
    return scenario


def _normalize_action(action: Dict[str, Any]) -> Dict[str, Any]:
    """
    Flacht Aktionen ab: bevorzugt Felder in action["data"], behält type und store_as.
    """
    data = action.get("data", {}) if isinstance(action.get("data", {}), dict) else {}
    merged = {k: v for k, v in action.items() if k not in {"data"}}
    # fields in data override same-named fields in the outer action
    merged.update(data)
    return merged


def _parse_year_month_from_date(date_value: Optional[str]):
    if not date_value or not isinstance(date_value, str):
        return None, None
    try:
        # accept YYYY-MM or YYYY-MM-DD
        parts = date_value.split("-")
        if len(parts) >= 2:
            year = int(parts[0])
            month = int(parts[1])
            return year, month
    except Exception:
        return None, None
    return None, None


def _resolve_scenario_id(ref, current_user, aliases: Dict[str, str]):
    if ref is None:
        return None
    if isinstance(ref, str) and ref.startswith("$"):
        return aliases.get(ref[1:])
    # try as direct id
    scenario = repo.get_scenario(ref)
    if scenario and scenario.get("user_id") == current_user["id"]:
        return scenario["id"]
    # try lookup by name for this user
    scenarios = repo.list_scenarios_for_user(current_user["id"])
    for s in scenarios:
        if s.get("name") == ref:
            return s.get("id")
    return None


def _apply_plan_action(action: Dict[str, Any], current_user, aliases: Dict[str, str]):
    action = _normalize_action(action)
    applied = None
    action_type = action.get("type")

    def resolve(value):
        if isinstance(value, str) and value.startswith("$"):
            return aliases.get(value[1:], value)
        return value

    if action_type == "create_scenario":
        payload = {
            "user_id": current_user["id"],
            "name": action.get("name"),
            "start_year": action.get("start_year"),
            "start_month": action.get("start_month"),
            "end_year": action.get("end_year"),
            "end_month": action.get("end_month"),
            "description": action.get("description"),
            "inflation_rate": action.get("inflation_rate"),
            "income_tax_rate": action.get("income_tax_rate"),
            "wealth_tax_rate": action.get("wealth_tax_rate"),
        }
        required = ["name", "start_year", "start_month", "end_year", "end_month"]
        if any(payload.get(k) is None for k in required):
            raise HTTPException(status_code=400, detail=f"Missing fields for create_scenario: {required}")
        applied = repo.create_scenario(
            payload["user_id"],
            payload["name"],
            payload["start_year"],
            payload["start_month"],
            payload["end_year"],
            payload["end_month"],
            payload["description"],
            payload["inflation_rate"],
            payload["income_tax_rate"],
            payload["wealth_tax_rate"],
        )

    elif action_type == "create_asset":
        scenario_id = _resolve_scenario_id(action.get("scenario_id") or action.get("scenario"), current_user, aliases)
        _ensure_scenario_access(scenario_id, current_user)
        payload = {
            "name": action.get("name"),
            "annual_growth_rate": action.get("annual_growth_rate") or 0.0,
            "initial_balance": action.get("initial_balance") or 0.0,
            "asset_type": action.get("asset_type") or "generic",
            "start_year": action.get("start_year"),
            "start_month": action.get("start_month"),
            "end_year": action.get("end_year"),
            "end_month": action.get("end_month"),
        }
        if not payload["name"]:
            raise HTTPException(status_code=400, detail="Missing name for create_asset")
        if not payload["start_year"] and action.get("purchase_date"):
            y, m = _parse_year_month_from_date(action.get("purchase_date"))
            payload["start_year"], payload["start_month"] = y, m
        if not payload["start_year"] and action.get("start_date"):
            y, m = _parse_year_month_from_date(action.get("start_date"))
            payload["start_year"], payload["start_month"] = y, m
        applied = repo.add_asset(
            scenario_id,
            payload["name"],
            payload["annual_growth_rate"],
            payload["initial_balance"],
            payload["asset_type"],
            payload["start_year"],
            payload["start_month"],
            payload["end_year"],
            payload["end_month"],
        )

    elif action_type == "create_liability":
        scenario_id = _resolve_scenario_id(action.get("scenario_id") or action.get("scenario"), current_user, aliases)
        _ensure_scenario_access(scenario_id, current_user)
        name = action.get("name") or action.get("type") or "Liability"
        amount = action.get("amount") or 0.0
        annual_rate = action.get("annual_interest_rate") or action.get("interest_rate") or action.get("annual_growth_rate")
        start_year, start_month = _parse_year_month_from_date(action.get("start_date"))
        applied = repo.add_asset(
            scenario_id,
            name,
            annual_rate or 0.0,
            -abs(amount),
            "mortgage",
            start_year,
            start_month,
            action.get("end_year"),
            action.get("end_month"),
        )

    elif action_type == "create_transaction":
        scenario_id = _resolve_scenario_id(action.get("scenario_id") or action.get("scenario"), current_user, aliases)
        _ensure_scenario_access(scenario_id, current_user)
        asset_id = resolve(action.get("asset_id"))
        if not asset_id:
            raise HTTPException(status_code=400, detail="asset_id required for create_transaction")
        asset = repo.get_asset(asset_id)
        if not asset or asset["scenario_id"] != scenario_id:
            raise HTTPException(status_code=400, detail="Asset not part of scenario")

        tx_type = action.get("type") or "one_time"
        annual_interest_rate = action.get("annual_interest_rate")
        if tx_type == "mortgage_interest" and annual_interest_rate is None:
            annual_interest_rate = action.get("annual_growth_rate")
        applied = repo.add_transaction(
            scenario_id,
            asset_id,
            action.get("name") or "AI Transaction",
            action.get("amount") or 0.0,
            tx_type,
            action.get("start_year"),
            action.get("start_month"),
            action.get("end_year") or action.get("start_year"),
            action.get("end_month") or action.get("start_month"),
            action.get("frequency"),
            action.get("annual_growth_rate") or 0.0,
            action.get("counter_asset_id"),
            action.get("double_entry") or False,
            action.get("mortgage_asset_id"),
            annual_interest_rate,
            action.get("taxable") or False,
            action.get("taxable_amount"),
        )

    else:
        raise HTTPException(status_code=400, detail=f"Unknown plan action type: {action_type}")

    return applied


@app.post("/assistant/chat", response_model=AssistantChatResponse)
def assistant_chat(payload: AssistantChatRequest, current_user=Depends(get_current_user)):
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages required")

    client = get_openai_client()
    if not client:
        fallback_reply = (
            "Assistant ist aktiv, aber es ist kein OPENAI_API_KEY gesetzt. "
            "Oder der Client konnte nicht initialisiert werden (httpx/proxy Issue). "
            "Bitte Key setzen oder httpx auf eine kompatible Version bringen."
        )
        new_messages = payload.messages + [AssistantMessage(role="assistant", content=fallback_reply)]
        return AssistantChatResponse(messages=new_messages, plan=None, reply=fallback_reply)

    system_prompt = (
        "Du hilfst, Finanzereignisse in ein Szenario zu übernehmen (Assets, Hypotheken, Transaktionen). "
        "Frage nach fehlenden Daten, fasse strukturiert zusammen und schlage einen Plan mit Aktionen vor. "
        "Antworte kurz. Wenn möglich, liefere einen JSON-Plan mit Aktionen (type: create_scenario/create_asset/create_transaction). "
        "Wenn Angaben fehlen, stelle Rückfragen."
    )

    chat_messages = [{"role": "system", "content": system_prompt}]
    for m in payload.messages:
        chat_messages.append({"role": m.role, "content": m.content})

    try:
        completion = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            messages=chat_messages,
            temperature=0.3,
        )
        reply = completion.choices[0].message.content or "OK"
    except Exception as exc:  # pragma: no cover - external API
        raise HTTPException(status_code=500, detail=f"Assistant call failed: {exc}")

    # Attempt to extract a JSON plan from the reply
    def extract_plan(text: str):
        if not text:
            return None
        # Look for a fenced ```json ... ``` block first
        fence_match = re.search(r"```json\\s*(\\{.*?\\})\\s*```", text, re.DOTALL | re.IGNORECASE)
        candidate = fence_match.group(1) if fence_match else None
        if not candidate:
            # Fallback: first JSON object in text
            brace_match = re.search(r"\\{.*\\}", text, re.DOTALL)
            candidate = brace_match.group(0) if brace_match else None
        if not candidate:
            return None
        try:
            return json.loads(candidate)
        except Exception:
            return None

    plan = extract_plan(reply)

    assistant_msg = AssistantMessage(role="assistant", content=reply)
    updated_messages = payload.messages + [assistant_msg]

    return AssistantChatResponse(messages=updated_messages, plan=plan, reply=reply)


@app.post("/assistant/apply")
def assistant_apply(payload: AssistantApplyRequest, current_user=Depends(get_current_user)):
    plan = payload.plan or {}
    actions = plan.get("actions") if isinstance(plan, dict) else None
    if not actions or not isinstance(actions, list):
        raise HTTPException(status_code=400, detail="plan.actions must be a list")

    applied = []
    aliases: Dict[str, str] = {}
    for action in actions:
        if not isinstance(action, dict):
            continue
        applied_item = _apply_plan_action(action, current_user, aliases)
        alias_key = action.get("store_as")
        if alias_key and isinstance(alias_key, str):
            if isinstance(applied_item, dict) and applied_item.get("id"):
                aliases[alias_key] = applied_item["id"]
            else:
                aliases[alias_key] = str(applied_item)
        applied.append(applied_item)

    return {"status": "applied", "count": len(applied), "results": applied}
