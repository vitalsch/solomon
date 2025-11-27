from __future__ import annotations

import os
import json
import re
import httpx
from datetime import datetime
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

# Patch httpx.Client/__init__ to accept "proxies" kwarg (OpenAI may pass it) for newer httpx versions
try:
    _orig_client_init = httpx.Client.__init__
    _orig_async_client_init = httpx.AsyncClient.__init__

    def _patched_client_init(self, *args, **kwargs):
        if "proxies" in kwargs and "proxy" not in kwargs:
            kwargs["proxy"] = kwargs.pop("proxies")
        return _orig_client_init(self, *args, **kwargs)

    def _patched_async_client_init(self, *args, **kwargs):
        if "proxies" in kwargs and "proxy" not in kwargs:
            kwargs["proxy"] = kwargs.pop("proxies")
        return _orig_async_client_init(self, *args, **kwargs)

    httpx.Client.__init__ = _patched_client_init  # type: ignore
    httpx.AsyncClient.__init__ = _patched_async_client_init  # type: ignore
except Exception:
    pass


def get_openai_client():
    """
    Build the OpenAI client lazily to avoid import-time crashes (e.g. httpx proxy signature mismatch).
    Returns None if no key is set or if the client cannot be constructed.
    """
    global _cached_openai_client
    if _cached_openai_client is not None:
        return _cached_openai_client
    if not OpenAI:
        print("[assistant] OpenAI SDK not available")
        return None
    if not OPENAI_API_KEY:
        print("[assistant] OPENAI_API_KEY not set")
        return None
    try:
        _cached_openai_client = OpenAI(api_key=OPENAI_API_KEY)
    except Exception as exc:
        print(f"[assistant] failed to init OpenAI client: {exc}")
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
    Flacht Aktionen ab: bevorzugt Felder in action["data"], action["asset"], action["transaction"],
    behält type und store_as.
    """
    merged = {k: v for k, v in action.items() if k not in {"data", "asset", "transaction"}}
    for key in ("data", "asset", "transaction"):
        payload = action.get(key, {})
        if isinstance(payload, dict):
            merged.update(payload)
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


def _resolve_scenario_id(ref, current_user, aliases: Dict[str, str], fallback_last=None):
    if ref is None:
        ref = fallback_last
    if isinstance(ref, str) and ref.startswith("$"):
        return aliases.get(ref[1:])
    if isinstance(ref, str) and ref.lower() == "current":
        return fallback_last
    ref_norm = str(ref).strip().lower() if ref is not None else None
    # try as direct id
    scenario = None
    try:
        scenario = repo.get_scenario(ref)
    except Exception as exc:
        # e.g. invalid ObjectId format; ignore and fall through to name lookup
        print(f"[assistant] scenario lookup by id failed for '{ref}': {exc}")
    if scenario and scenario.get("user_id") == current_user["id"]:
        return scenario["id"]
    # try lookup by name for this user
    scenarios = repo.list_scenarios_for_user(current_user["id"])
    if ref is None and len(scenarios) == 1:
        return scenarios[0].get("id")
    for s in scenarios:
        name_norm = str(s.get("name") or "").strip().lower()
        if ref_norm and name_norm == ref_norm:
            return s.get("id")
    if fallback_last:
        return fallback_last
    return None


def _ensure_unique_scenario_name(user_id: str, name: str):
    """Ensure the user has no other scenario with the same (case-insensitive) name."""
    existing = repo.list_scenarios_for_user(user_id)
    for s in existing:
        if s.get("name") and s["name"].lower() == name.lower():
            raise HTTPException(status_code=400, detail=f"Scenario name '{name}' is already in use.")


def _ensure_unique_asset_name(scenario_id: str, name: str):
    """Ensure the scenario has no other asset with the same (case-insensitive) name."""
    assets = repo.list_assets_for_scenario(scenario_id)
    for a in assets:
        if a.get("name") and a["name"].lower() == name.lower():
            raise HTTPException(status_code=400, detail=f"Asset name '{name}' already exists in this scenario.")


def _ensure_unique_transaction_name(scenario_id: str, name: str):
    """Ensure the scenario has no other transaction with the same (case-insensitive) name."""
    txs = repo.list_transactions_for_scenario(scenario_id)
    for tx in txs:
        if tx.get("name") and tx["name"].lower() == name.lower():
            raise HTTPException(status_code=400, detail=f"Transaction name '{name}' already exists in this scenario.")


def _delete_transactions_by_name(scenario_id: str, name: str):
    """Delete all transactions in a scenario that match a name (case-insensitive)."""
    txs = repo.list_transactions_for_scenario(scenario_id)
    for tx in txs:
        if tx.get("name") and tx["name"].lower() == name.lower():
            try:
                repo.delete_transaction(tx["id"])
            except Exception as exc:
                print(f"[assistant] failed to delete tx '{name}' ({tx.get('id')}): {exc}")


def _delete_transaction_by_ref(scenario_id: str, ref, aliases: Dict[str, str]):
    tx_id = _resolve_transaction_id(ref, scenario_id, aliases)
    if not tx_id:
        raise HTTPException(status_code=404, detail="Transaction not found to delete")
    tx = repo.get_transaction(tx_id)
    if not tx or tx.get("scenario_id") != scenario_id:
        raise HTTPException(status_code=404, detail="Transaction not part of scenario")
    repo.delete_transaction(tx_id)
    return {"deleted_transaction_id": tx_id, "name": tx.get("name")}


def _resolve_asset_id(ref, scenario_id: str, aliases: Dict[str, str]):
    if ref is None:
        return None
    if isinstance(ref, str) and ref.startswith("$"):
        ref = aliases.get(ref[1:], ref)
    # try direct id
    asset = None
    try:
        asset = repo.get_asset(ref)
    except Exception:
        asset = None
    if asset and asset.get("scenario_id") == scenario_id:
        return asset["id"]
    # try by name in scenario
    assets = repo.list_assets_for_scenario(scenario_id)
    for a in assets:
        if a.get("name") and str(a["name"]).lower() == str(ref).lower():
            return a.get("id")
    return None


def _resolve_transaction_id(ref, scenario_id: str, aliases: Dict[str, str]):
    if ref is None:
        return None
    if isinstance(ref, str) and ref.startswith("$"):
        ref = aliases.get(ref[1:], ref)
    tx = None
    try:
        tx = repo.get_transaction(ref)
    except Exception:
        tx = None
    if tx and tx.get("scenario_id") == scenario_id:
        return tx.get("id")
    txs = repo.list_transactions_for_scenario(scenario_id)
    for t in txs:
        if t.get("name") and str(t["name"]).lower() == str(ref).lower():
            return t.get("id")
    return None


def _apply_plan_action(action: Dict[str, Any], current_user, aliases: Dict[str, str], last_scenario_id=None):
    action = _normalize_action(action)
    applied = None
    action_type = action.get("type")

    # Allow shorthand "transfer" as an action: treat as create_transaction with transfer subtype
    if action_type == "transfer":
        action["tx_type_internal"] = "transfer"
        action_type = "create_transaction"

    def resolve(value):
        if isinstance(value, str) and value.startswith("$"):
            return aliases.get(value[1:], value)
        return value

    if action_type == "create_scenario":
        # Default period if missing
        if action.get("start_year") is None or action.get("start_month") is None:
            today = datetime.utcnow()
            action["start_year"] = today.year
            action["start_month"] = today.month
        if action.get("end_year") is None or action.get("end_month") is None:
            action["end_year"] = (action.get("start_year") or datetime.utcnow().year) + 10
            action["end_month"] = 12
        if not action.get("name"):
            raise HTTPException(status_code=400, detail="Scenario name is required")
        _ensure_unique_scenario_name(current_user["id"], action["name"])
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
        # auto-alias by name
        if payload["name"] and payload["name"] not in aliases:
            aliases[payload["name"]] = applied.get("id")

    elif action_type == "use_scenario":
        scenario_id = _resolve_scenario_id(action.get("scenario_id") or action.get("scenario"), current_user, aliases, last_scenario_id)
        if not scenario_id:
            raise HTTPException(status_code=404, detail="Scenario not found for current user")
        scenario = repo.get_scenario(scenario_id)
        applied = scenario
    elif action_type == "create_asset":
        scenario_id = _resolve_scenario_id(action.get("scenario_id") or action.get("scenario"), current_user, aliases, last_scenario_id)
        _ensure_scenario_access(scenario_id, current_user)
        initial_balance = (
            action.get("initial_balance")
            if action.get("initial_balance") is not None
            else action.get("balance")
            if action.get("balance") is not None
            else action.get("value")
            if action.get("value") is not None
            else 0.0
        )
        inferred_type = action.get("asset_type") or action.get("type") or None
        if not inferred_type:
            lname = (action.get("name") or "").lower()
            if any(k in lname for k in ["konto", "account", "zkb"]):
                inferred_type = "bank_account"
            elif any(k in lname for k in ["hypo", "hypothek"]):
                inferred_type = "mortgage"
            elif any(k in lname for k in ["haus", "immobilie", "house"]):
                inferred_type = "real_estate"
        name_value = action.get("name")
        if not name_value:
            lname = (action.get("name") or action.get("type") or "").lower()
            if any(k in lname for k in ["konto", "account", "zkb"]):
                name_value = "ZKB Konto"
            elif any(k in lname for k in ["hypo", "hypothek"]):
                name_value = "Hypothek"
            elif any(k in lname for k in ["haus", "immobilie", "house"]):
                name_value = "Haus"
            else:
                name_value = "Asset"
        payload = {
            "name": name_value,
            "annual_growth_rate": action.get("annual_growth_rate") or 0.0,
            "initial_balance": initial_balance,
            "asset_type": inferred_type or "generic",
            "start_year": action.get("start_year"),
            "start_month": action.get("start_month"),
            "end_year": action.get("end_year"),
            "end_month": action.get("end_month"),
        }
        _ensure_unique_asset_name(scenario_id, payload["name"])
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
        if payload["name"] and payload["name"] not in aliases:
            aliases[payload["name"]] = applied.get("id")

    elif action_type == "create_liability":
        scenario_id = _resolve_scenario_id(action.get("scenario_id") or action.get("scenario"), current_user, aliases, last_scenario_id)
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
        scenario_id = _resolve_scenario_id(action.get("scenario_id") or action.get("scenario"), current_user, aliases, last_scenario_id)
        _ensure_scenario_access(scenario_id, current_user)
        asset_id = _resolve_asset_id(action.get("asset_id"), scenario_id, aliases)
        if not asset_id:
            # fallback: if only one asset in scenario, pick it
            assets = repo.list_assets_for_scenario(scenario_id)
            if len(assets) == 1:
                asset_id = assets[0]["id"]
        if not asset_id:
            raise HTTPException(status_code=400, detail="asset_id required for create_transaction")
        asset = repo.get_asset(asset_id)
        if not asset or asset["scenario_id"] != scenario_id:
            raise HTTPException(status_code=400, detail="Asset not part of scenario")

        tx_type = (
            action.get("tx_type_internal")
            or action.get("tx_type")
            or action.get("transaction_type")
            or action.get("tx_kind")
            or action.get("type")
            or "one_time"
        )
        tx_type = (tx_type or "one_time").lower()
        if tx_type == "transfer":
            tx_type = "regular"
        start_year = action.get("start_year")
        start_month = action.get("start_month")
        if (start_year is None or start_month is None) and action.get("start_date"):
            y, m = _parse_year_month_from_date(action.get("start_date"))
            start_year, start_month = start_year or y, start_month or m

        annual_interest_rate = action.get("annual_interest_rate")
        if tx_type == "mortgage_interest" and annual_interest_rate is None:
            annual_interest_rate = action.get("annual_growth_rate")
        tx_name = action.get("name") or "AI Transaction"
        overwrite = action.get("overwrite") or action.get("overwrite_existing") or action.get("replace")
        if overwrite:
            _delete_transactions_by_name(scenario_id, tx_name)
        _ensure_unique_transaction_name(scenario_id, tx_name)
        if action.get("double_entry"):
            counter_asset_id = _resolve_asset_id(action.get("counter_asset_id") or action.get("to_asset_id"), scenario_id, aliases)
            if not counter_asset_id:
                raise HTTPException(status_code=400, detail="counter_asset_id (or to_asset_id) required for double_entry")
            if counter_asset_id == asset_id:
                raise HTTPException(status_code=400, detail="counter_asset_id must differ from asset_id")
            debit_tx, credit_tx = repo.add_linked_transactions(
                scenario_id,
                asset_id,
                counter_asset_id,
                tx_name,
                action.get("amount") or 0.0,
                tx_type,
                start_year,
                start_month,
                action.get("end_year") or start_year,
                action.get("end_month") or start_month,
                action.get("frequency"),
                action.get("annual_growth_rate") or 0.0,
            )
            debit_tx["linked_transaction"] = credit_tx
            applied = debit_tx
        else:
            applied = repo.add_transaction(
                scenario_id,
                asset_id,
                tx_name,
                action.get("amount") or 0.0,
                tx_type,
                start_year,
                start_month,
                action.get("end_year") or start_year,
                action.get("end_month") or start_month,
                action.get("frequency"),
                action.get("annual_growth_rate") or 0.0,
                action.get("counter_asset_id"),
                action.get("double_entry") or False,
                action.get("mortgage_asset_id"),
                annual_interest_rate,
                action.get("taxable") or False,
                action.get("taxable_amount"),
            )
    elif action_type in {"delete_asset", "delete_liability"}:
        scenario_id = _resolve_scenario_id(action.get("scenario_id") or action.get("scenario"), current_user, aliases, last_scenario_id)
        _ensure_scenario_access(scenario_id, current_user)
        target_asset_id = _resolve_asset_id(action.get("asset_id") or action.get("name"), scenario_id, aliases)
        if not target_asset_id:
            raise HTTPException(status_code=404, detail="Asset not found to delete")
        asset = repo.get_asset(target_asset_id)
        if not asset or asset.get("scenario_id") != scenario_id:
            raise HTTPException(status_code=404, detail="Asset not part of scenario")
        repo.delete_asset(target_asset_id)
        applied = {"deleted_asset_id": target_asset_id, "name": asset.get("name")}
    elif action_type == "delete_transaction":
        scenario_id = _resolve_scenario_id(action.get("scenario_id") or action.get("scenario"), current_user, aliases, last_scenario_id)
        _ensure_scenario_access(scenario_id, current_user)
        applied = _delete_transaction_by_ref(scenario_id, action.get("transaction_id") or action.get("name"), aliases)

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
       "Vorgehen:\n"
        "1) Arbeite NUR im Kontext des aktuell eingeloggten Nutzers. Keine Daten anderer Nutzer lesen oder ändern. "
        "   Nutze standardmäßig das vom Frontend übergebene aktuelle Szenario. "
        "   Wenn ein Szenario-Name genannt wird und es für diesen Nutzer nicht existiert, lege es neu an. "
        "   Zum Wechseln auf ein bestehendes Szenario kannst du die Aktion use_scenario nutzen. "
        "2) Ermittele fehlende Pflichtfelder je Aktion, frage nach: "
        "   - use_scenario: scenario (Name/ID) des Nutzers. Wenn nichts angegeben ist, nimm das aktuell ausgewählte Szenario. "
        "   - create_scenario: name, (optional start/end); wenn nicht angegeben, nehme Start=aktueller Monat, Ende=Startjahr+10, Monat 12. "
        "   - create_asset: scenario (Name/ID), name, initial_balance (oder balance/value), asset_type (default generic). "
        "     Wenn asset_type fehlt und der Name enthält Konto/Account/ZKB, setze asset_type=bank_account. "
        "     Wenn name fehlt und Konto/Account/ZKB im Text, setze name='ZKB Konto', sonst verwende einen generischen Namen (kein Nachfragen). "
        "     Wenn asset_type fehlt und sonst nichts passt, setze generic (nicht nachfragen). "
        "   - create_liability: scenario, name, amount, interest_rate (falls Hypothek), optional start_date. "
        "   - create_transaction: scenario, asset_id, name, amount, type, start_year/start_month (oder start_date). "
        "     Asset-IDs NICHT erfragen: du kannst nach Namen auflösen. Nutze asset_id als Name oder Alias (z.B. ZKB Konto, ZKB Depot). "
        "   - delete_asset|delete_liability: scenario, asset_id (Name/ID/Alias) im aktuellen Szenario löschen. "
        "   - delete_transaction: scenario, name oder transaction_id im aktuellen Szenario löschen. "
        "3) Wenn alle Pflichtfelder da sind, wende den Plan an (keine Ausrede, dass du es nicht kannst) und bestätige kurz. "
        "   Nur wenn etwas fehlt, kurz nachfragen. "
        "4) Gib IMMER am Ende einen JSON-Plan in ```json ... ``` zurück, Schema: "
        "{ \"actions\": [ { \"type\": \"use_scenario|create_scenario|create_asset|create_liability|create_transaction|delete_asset|delete_liability|delete_transaction\", "
        "\"scenario\"|\"scenario_id\": \"...\", optional \"store_as\": \"alias\", Felder wie name, amount, start_date, initial_balance, asset_type, interest_rate usw. } ] }. "
        "Nutze Aliase (store_as) und referenziere sie in nachfolgenden Aktionen mit \"$alias\". "
        "Wenn noch Daten fehlen, frage danach und gib einen leeren Plan {\"actions\":[]} zurück. "
        "Antworte kurz, schreibe NICHT, dass du nur einen Plan erstellen kannst."
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
        fence_match = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL | re.IGNORECASE)
        candidate = fence_match.group(1) if fence_match else None
        if not candidate:
            # Fallback: first JSON object in text
            brace_match = re.search(r"\{.*\}", text, re.DOTALL)
            candidate = brace_match.group(0) if brace_match else None
        if not candidate:
            return None
        try:
            return json.loads(candidate)
        except Exception as exc:
            print(f"[assistant] plan json parse failed: {exc}")
            return None

    plan = extract_plan(reply)
    applied_results = None
    if plan and isinstance(plan, dict) and isinstance(plan.get("actions"), list) and len(plan["actions"]) > 0:
        try:
            # prefer context scenario if provided
            ctx = payload.context or {}
            initial_scenario_ref = ctx.get("scenario_id") or ctx.get("scenario_name")
            applied_results = _apply_plan(plan, current_user, initial_scenario_ref=initial_scenario_ref)
            print(f"[assistant] applied {len(applied_results)} actions")
        except HTTPException as exc:
            applied_results = {"error": exc.detail}
            print(f"[assistant] apply http error: {exc.detail}")
        except Exception as exc:  # pragma: no cover
            applied_results = {"error": str(exc)}
            print(f"[assistant] apply error: {exc}")

    assistant_reply = reply
    if applied_results is not None:
        if isinstance(applied_results, dict) and applied_results.get("error"):
            assistant_reply = f"{reply}\n\n(Auto-apply Fehler: {applied_results.get('error')})"
        else:
            assistant_reply = f"{reply}\n\n(Auto-apply: {len(applied_results)} Aktionen ausgeführt.)"

    assistant_msg = AssistantMessage(role="assistant", content=assistant_reply)
    updated_messages = payload.messages + [assistant_msg]

    # If we applied, clear plan (already executed) but keep results
    if applied_results is not None:
        return AssistantChatResponse(messages=updated_messages, plan=None, reply=assistant_reply)
    return AssistantChatResponse(messages=updated_messages, plan=plan, reply=assistant_reply)


@app.post("/assistant/apply")
def assistant_apply(payload: AssistantApplyRequest, current_user=Depends(get_current_user)):
    plan = payload.plan or {}
    actions = plan.get("actions") if isinstance(plan, dict) else None
    if not actions or not isinstance(actions, list):
        raise HTTPException(status_code=400, detail="plan.actions must be a list")

    applied = _apply_plan(plan, current_user)
    return {"status": "applied", "count": len(applied), "results": applied}


def _apply_plan(plan: Dict[str, Any], current_user, initial_scenario_ref=None):
    actions = plan.get("actions") if isinstance(plan, dict) else None
    if not actions or not isinstance(actions, list):
        return []
    applied = []
    aliases: Dict[str, str] = {}
    last_scenario_id = _resolve_scenario_id(initial_scenario_ref, current_user, aliases, None)
    for action in actions:
        if not isinstance(action, dict):
            continue
        applied_item = _apply_plan_action(action, current_user, aliases, last_scenario_id)
        alias_key = action.get("store_as")
        if alias_key and isinstance(alias_key, str):
            if isinstance(applied_item, dict) and applied_item.get("id"):
                aliases[alias_key] = applied_item["id"]
            else:
                aliases[alias_key] = str(applied_item)
        # track last scenario to reduce required fields in follow-ups
        if isinstance(applied_item, dict) and applied_item.get("id") and action.get("type") in {"create_scenario", "use_scenario"}:
            last_scenario_id = applied_item["id"]
        # auto-alias asset/transaction names if not set
        if action.get("type") == "create_asset" and isinstance(applied_item, dict) and applied_item.get("id"):
            asset_name = applied_item.get("name")
            if asset_name and asset_name not in aliases:
                aliases[asset_name] = applied_item["id"]
        if action.get("type") == "create_transaction" and isinstance(applied_item, dict) and applied_item.get("id"):
            tx_name = applied_item.get("name")
            if tx_name and tx_name not in aliases:
                aliases[tx_name] = applied_item["id"]
        applied.append(applied_item)
    return applied
