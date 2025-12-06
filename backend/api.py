from __future__ import annotations

import os
import json
import re
from pathlib import Path
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

# Optional YAML config for agent roles/validation
try:
    import yaml  # type: ignore
except Exception:  # pragma: no cover - dependency optional
    yaml = None  # type: ignore

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
    municipal_tax_factor: Optional[float] = Field(None, description="Gemeindesteuerfuss (z.B. 1.15 für 115%)")
    cantonal_tax_factor: Optional[float] = Field(None, description="Staatssteuerfuss (z.B. 0.98 für 98%)")
    church_tax_factor: Optional[float] = Field(None, description="Kirchensteuerfuss (z.B. 0.14 für 14%)")
    personal_tax_per_person: Optional[float] = Field(None, description="Personalsteuer pro Person in CHF")
    tax_account_id: Optional[str] = Field(None, description="Asset/Konto, von dem Steuern abgebucht werden sollen")

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
    municipal_tax_factor: Optional[float] = None
    cantonal_tax_factor: Optional[float] = None
    church_tax_factor: Optional[float] = None
    personal_tax_per_person: Optional[float] = None
    tax_account_id: Optional[str] = None


class PortfolioShock(BaseModel):
    pct: float = Field(..., description="Additive Anpassung in Dezimal (z.B. -0.2 = -20 %-Punkte, 0.1 = +10 %-Punkte)")
    start_year: Optional[int] = None
    start_month: Optional[int] = None
    end_year: Optional[int] = None
    end_month: Optional[int] = None


class SimulationOverride(BaseModel):
    portfolio_growth_pct: Optional[float] = Field(
        default=None,
        description="Relative Anpassung der Wachstumsrate für Portfolio-Assets (z.B. -0.2 = -20%). Wird ignoriert, wenn portfolio_shocks gesetzt ist.",
    )
    portfolio_start_year: Optional[int] = None
    portfolio_start_month: Optional[int] = None
    portfolio_end_year: Optional[int] = None
    portfolio_end_month: Optional[int] = None
    portfolio_shocks: Optional[List[PortfolioShock]] = None
    real_estate_shocks: Optional[List[PortfolioShock]] = None
    mortgage_rate_shocks: Optional[List[PortfolioShock]] = None
    income_tax_shocks: Optional[List[PortfolioShock]] = None
    inflation_shocks: Optional[List[PortfolioShock]] = None

class StressProfileCreate(BaseModel):
    name: str
    description: Optional[str] = None
    overrides: Dict[str, Any]

class StressProfileUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    overrides: Optional[Dict[str, Any]] = None

class AssetCreate(BaseModel):
    name: str
    annual_growth_rate: float = 0.0
    initial_balance: float = 0.0
    asset_type: Literal["generic", "real_estate", "bank_account", "mortgage", "portfolio"] = "generic"
    start_year: Optional[int] = None
    start_month: Optional[int] = None
    end_year: Optional[int] = None
    end_month: Optional[int] = None


class AssetUpdate(BaseModel):
    name: Optional[str] = None
    annual_growth_rate: Optional[float] = None
    initial_balance: Optional[float] = None
    asset_type: Optional[Literal["generic", "real_estate", "bank_account", "mortgage", "portfolio"]] = None
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


class TaxBracket(BaseModel):
    cap: Optional[float] = Field(None, description="Grenze dieses Abschnitts (CHF). Null = unbegrenzt")
    rate: float = Field(..., description="Steuersatz als Dezimal (z.B. 0.13 für 13%)")


class FederalTaxRow(BaseModel):
    income: float = Field(..., description="Einkommensgrenze für diesen Abschnitt (CHF)")
    base: float = Field(..., description="Sockelbetrag in CHF")
    per100: float = Field(..., description="Zusatz pro 100 CHF über income")


class TaxProfileCreate(BaseModel):
    name: str
    description: Optional[str] = None
    location: Optional[str] = Field(None, description="Ort/Gemeinde des Tarifs")
    church: Optional[str] = Field(None, description="Kirchsteuer Zugehörigkeit (z.B. kath, ref, keine)")
    marital_status: Optional[str] = Field(None, description="Zivilstand (ledig, verheiratet, verwitwet, etc.)")
    income_brackets: List[TaxBracket] = Field(default_factory=list)
    wealth_brackets: List[TaxBracket] = Field(default_factory=list)
    federal_table: List[FederalTaxRow] = Field(default_factory=list)
    municipal_tax_factor: Optional[float] = Field(None, description="Gemeindesteuerfuss (z.B. 1.15 für 115%)")
    cantonal_tax_factor: Optional[float] = Field(None, description="Staatssteuerfuss (z.B. 0.98 für 98%)")
    church_tax_factor: Optional[float] = Field(None, description="Kirchensteuerfuss (z.B. 0.14 für 14%)")
    personal_tax_per_person: Optional[float] = Field(None, description="Personalsteuer pro Person in CHF")


class TaxProfileUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    church: Optional[str] = None
    marital_status: Optional[str] = None
    income_brackets: Optional[List[TaxBracket]] = None
    wealth_brackets: Optional[List[TaxBracket]] = None
    federal_table: Optional[List[FederalTaxRow]] = None
    municipal_tax_factor: Optional[float] = None
    cantonal_tax_factor: Optional[float] = None
    church_tax_factor: Optional[float] = None
    personal_tax_per_person: Optional[float] = None


class TaxProfileImportRequest(BaseModel):
    profiles: List[TaxProfileCreate] = Field(default_factory=list)


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
        payload.municipal_tax_factor,
        payload.cantonal_tax_factor,
        payload.church_tax_factor,
        payload.personal_tax_per_person,
        payload.tax_account_id,
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
    start_year = payload.start_year or scenario["start_year"]
    start_month = payload.start_month or scenario["start_month"]
    end_year = payload.end_year or scenario["end_year"]
    end_month = payload.end_month or scenario["end_month"]
    return repo.add_asset(
        scenario_id,
        payload.name,
        payload.annual_growth_rate,
        payload.initial_balance,
        payload.asset_type,
        start_year,
        start_month,
        end_year,
        end_month,
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


@app.post("/scenarios/{scenario_id}/simulate/stress")
def simulate_scenario_stress(
    scenario_id: str, payload: SimulationOverride, current_user=Depends(get_current_user)
):
    scenario = repo.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if scenario["user_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this scenario")
    try:
        return run_scenario_simulation(scenario_id, repo, overrides=payload.dict(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# Stress Profiles ----------------------------------------------------------
@app.get("/stress-profiles")
def list_stress_profiles(current_user=Depends(get_current_user)):
    return repo.list_stress_profiles(current_user["id"])


@app.post("/stress-profiles")
def create_stress_profile(payload: StressProfileCreate, current_user=Depends(get_current_user)):
    return repo.create_stress_profile(current_user["id"], payload.name, payload.description, payload.overrides)


@app.patch("/stress-profiles/{profile_id}")
def update_stress_profile(profile_id: str, payload: StressProfileUpdate, current_user=Depends(get_current_user)):
    updated = repo.update_stress_profile(profile_id, current_user["id"], {k: v for k, v in payload.dict().items() if v is not None})
    if not updated:
        raise HTTPException(status_code=404, detail="Stress profile not found")
    return updated


@app.delete("/stress-profiles/{profile_id}")
def delete_stress_profile(profile_id: str, current_user=Depends(get_current_user)):
    ok = repo.delete_stress_profile(profile_id, current_user["id"])
    if not ok:
        raise HTTPException(status_code=404, detail="Stress profile not found")
    return {"status": "deleted"}


# Tax Profiles ------------------------------------------------------------
@app.get("/tax-profiles")
def list_tax_profiles(current_user=Depends(get_current_user)):
    return repo.list_tax_profiles(current_user["id"])


@app.post("/tax-profiles")
def create_tax_profile(payload: TaxProfileCreate, current_user=Depends(get_current_user)):
    return repo.create_tax_profile(
        current_user["id"],
        payload.name,
        payload.description,
        payload.location,
        payload.church,
        payload.marital_status,
        payload.income_brackets,
        payload.wealth_brackets,
        payload.federal_table,
        payload.municipal_tax_factor,
        payload.cantonal_tax_factor,
        payload.church_tax_factor,
        payload.personal_tax_per_person,
    )


@app.get("/tax-profiles/{profile_id}")
def get_tax_profile(profile_id: str, current_user=Depends(get_current_user)):
    profile = repo.get_tax_profile(profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Tax profile not found")
    if profile.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to access this tax profile")
    return profile


@app.patch("/tax-profiles/{profile_id}")
def update_tax_profile(profile_id: str, payload: TaxProfileUpdate, current_user=Depends(get_current_user)):
    existing = repo.get_tax_profile(profile_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Tax profile not found")
    if existing.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to modify this tax profile")
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    updated = repo.update_tax_profile(profile_id, current_user["id"], updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Tax profile not found")
    return updated


@app.delete("/tax-profiles/{profile_id}")
def delete_tax_profile(profile_id: str, current_user=Depends(get_current_user)):
    ok = repo.delete_tax_profile(profile_id, current_user["id"])
    if not ok:
        raise HTTPException(status_code=404, detail="Tax profile not found")
    return {"status": "deleted"}


@app.post("/tax-profiles/import")
def import_tax_profiles(payload: TaxProfileImportRequest, current_user=Depends(get_current_user)):
    if not payload.profiles:
        raise HTTPException(status_code=400, detail="No profiles provided")
    created = []
    for profile in payload.profiles:
        created.append(
            repo.create_tax_profile(
                current_user["id"],
                profile.name,
                profile.description,
                profile.location,
                profile.church,
                profile.marital_status,
                profile.income_brackets,
                profile.wealth_brackets,
                profile.federal_table,
                profile.municipal_tax_factor,
                profile.cantonal_tax_factor,
                profile.church_tax_factor,
                profile.personal_tax_per_person,
            )
        )
    return created


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
    date_value = date_value.strip()
    # Accept formats: YYYY-MM, YYYY-MM-DD, MM/YYYY, MM-YYYY, MM.YYYY, DD.MM.YYYY (month is the middle or after separator)
    try:
        # YYYY-MM or YYYY-MM-DD
        parts = date_value.split("-")
        if len(parts) >= 2 and len(parts[0]) == 4:
            year = int(parts[0])
            month = int(parts[1])
            return year, month
        # MM/YYYY or MM-YYYY or MM.YYYY
        for sep in ["/", "-", "."]:
            if sep in date_value and len(date_value.split(sep)) == 2:
                m, y = date_value.split(sep)
                month = int(m)
                year = int(y)
                return year, month
        # DD.MM.YYYY -> take middle as month
        if date_value.count(".") == 2:
            dd, mm, yyyy = date_value.split(".")
            year = int(yyyy)
            month = int(mm)
            return year, month
    except Exception:
        return None, None
    return None, None


def _parse_year_month_fuzzy(value: Optional[str]):
    """Parse year/month from various strings like '1/2026', '01/2026', '2026-01', 'Jan 2026'."""
    if not value or not isinstance(value, str):
        return None, None
    y, m = _parse_year_month_from_date(value)
    if y and m:
        return y, m
    try:
        import re

        match = re.search(r"(\d{1,2})\D+(\d{4})", value)
        if match:
            month = int(match.group(1))
            year = int(match.group(2))
            return year, month
    except Exception:
        return None, None
    return None, None


def _parse_rate(value):
    """Parse a rate that might be given als 0.02, 2, '2%', oder '0,02'."""
    if value is None:
        return None
    try:
        if isinstance(value, str):
            import re

            # Extract first numeric chunk (supports commas, dots, percent)
            match = re.search(r"([-+]?\d+[.,]?\d*)", value)
            if not match:
                return None
            val = match.group(1).replace(",", ".")
            rate = float(val)
            has_percent = "%" in value or "prozent" in value.lower()
        else:
            rate = float(value)
            has_percent = False
        # If a percent marker is present, always divide by 100 (e.g. 1% -> 0.01)
        if has_percent and rate is not None:
            rate = rate / 100.0
        # If no percent marker: interpret values >=1 als Prozentangabe (1 -> 0.01, 2 -> 0.02, 50 -> 0.5)
        if not has_percent and rate >= 1 and rate <= 100:
            rate = rate / 100.0
        return rate
    except Exception:
        return None


def _load_agent_config():
    default = {
        "roles": ["orchestrator", "szenario", "konto", "immo", "hypo", "zins"],
        "actions": {
            "create_scenario": {"required": ["name", "start_year", "start_month", "end_year", "end_month"]},
            "create_asset": {
                "required": ["name", "annual_growth_rate"],
                "asset_types": {"bank": ["konto", "account", "zkb", "depot"], "real_estate": ["haus", "immobilie", "home"]},
            },
            "create_liability": {"required": ["name", "amount"], "defaults": {}},
            "update_asset": {"required": ["asset_id"]},
            "create_transaction": {
                "required": ["asset_id", "name", "type", "start_year", "start_month"],
                "per_type": {
                    "mortgage_interest": {
                        "required": ["asset_id", "mortgage_asset_id", "annual_interest_rate", "frequency", "start_year", "start_month"],
                        "allow_amount_zero": True,
                    }
                },
            },
        },
    }
    cfg_path = Path(__file__).parent / "agent_config.yaml"
    if yaml is None or not cfg_path.exists():
        return default
    try:
        with cfg_path.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
            if isinstance(data, dict):
                return data
    except Exception:
        return default
    return default


AGENT_CONFIG = _load_agent_config()


def _validate_actions(actions: List[Dict[str, Any]]) -> List[str]:
    """
    Basic pre-flight validation to avoid running incomplete plans.
    Returns a list of human-readable missing-field messages.
    """
    missing: List[str] = []
    for idx, action in enumerate(actions or []):
        if not isinstance(action, dict):
            continue
        a_type = (action.get("type") or action.get("action") or "").lower()
        label = f"Aktion {idx+1} ({a_type or 'unbekannt'})"
        cfg_actions = AGENT_CONFIG.get("actions", {})
        # normalize interest helper
        if a_type == "create_interest_transaction":
            action["type"] = "create_transaction"
            if not action.get("type_tx") and not action.get("tx_type"):
                action["tx_type"] = "mortgage_interest"
            a_type = "create_transaction"
        cfg = cfg_actions.get(a_type, {})
        base_required = cfg.get("required", [])
        per_type = (cfg.get("per_type") or {}) if isinstance(cfg, dict) else {}

        # helper to check presence
        def _has(field: str) -> bool:
            return action.get(field) is not None

        need = []
        for field in base_required:
            if not _has(field):
                need.append(field)

        # Special handling for start_date fallback
        if any(f in base_required for f in ["start_year", "start_month"]):
            if not (_has("start_year") and _has("start_month")) and not _has("start_date"):
                if "start_year/start_month" not in need:
                    need.append("start_year/start_month oder start_date")
                need = [n for n in need if n not in {"start_year", "start_month"}]

        if a_type == "create_transaction":
            tx_type = _normalize_tx_type(action.get("tx_type") or action.get("transaction_type") or action.get("type"))
            type_cfg = per_type.get(tx_type, {})
            for field in type_cfg.get("required", []):
                if not _has(field):
                    need.append(field)
            if tx_type in {"mortgage_interest", "zinsausgaben"}:
                # Accept alias fields and parsed rates
                rate = (
                    action.get("annual_interest_rate")
                    or action.get("interest_rate")
                    or action.get("zinssatz")
                    or action.get("zins")
                    or action.get("annual_growth_rate")
                )
                if rate is None and "annual_interest_rate" in type_cfg.get("required", []):
                    need.append("annual_interest_rate/interest_rate/zinssatz")
                if not _has("frequency"):
                    need.append("frequency")
                if not (_has("start_year") and _has("start_month")) and not _has("start_date"):
                    need.append("start_year/start_month oder start_date")

            # Double entry (Transfer/Umbuchung): asset_id und counter_asset_id erforderlich
            if action.get("double_entry"):
                if action.get("asset_id") is None and action.get("from_asset") is None:
                    need.append("asset_id (Zahler)")
                if action.get("counter_asset_id") is None and action.get("to_asset") is None:
                    need.append("counter_asset_id (Empfänger)")
                if action.get("amount") is None:
                    need.append("amount")
                if not (_has("start_year") and _has("start_month")) and not _has("start_date"):
                    need.append("start_year/start_month oder start_date")

        if need:
            missing.append(f"{label}: fehlend -> {', '.join(sorted(set(need)))}")
    return missing


def _normalize_asset_type(value: Optional[str], name_hint: Optional[str] = None) -> Optional[str]:
    if not value and not name_hint:
        return None
    candidates = []
    if value:
        candidates.append(value)
    if name_hint:
        candidates.append(name_hint)
    for candidate in candidates:
        val = str(candidate or "").strip().lower()
        if not val:
            continue
        if val in {"real_estate", "immobilie", "immobilien", "haus", "house", "home"}:
            return "real_estate"
        if val in {"mortgage", "hypothek", "hypo"}:
            return "mortgage"
        if val in {"bank_account", "konto", "account", "zkb", "depot"}:
            return "bank_account"
    return None


def _normalize_tx_type(value: Optional[str]) -> str:
    """Normalize transaction type strings (spaces/hyphens) and map synonyms to canonical types."""
    tx_type = (value or "one_time").strip().lower().replace(" ", "_").replace("-", "_")
    if tx_type in {"zinsausgaben", "zinszahlung", "zinszahlungen", "interest_expense", "interest_payment"}:
        return "mortgage_interest"
    return tx_type or "one_time"


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


def _resolve_transaction_by_ref(scenario_id: str, ref, aliases: Dict[str, str]):
    tx_id = _resolve_transaction_id(ref, scenario_id, aliases)
    if not tx_id:
        return None
    tx = repo.get_transaction(tx_id)
    if not tx or tx.get("scenario_id") != scenario_id:
        return None
    return tx


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


def _apply_plan_action(action: Dict[str, Any], current_user, aliases: Dict[str, str], last_scenario_id=None, interest_rates=None, state=None):
    action = _normalize_action(action)
    applied = None
    action_type = action.get("type") or action.get("action")

    # Normalize interest helper to create_transaction/mortgage_interest
    if (action_type or "").lower() == "create_interest_transaction":
        action["tx_type"] = "mortgage_interest"
        action["type"] = "create_transaction"
        action_type = "create_transaction"
        if action.get("amount") is None:
            action["amount"] = 0.0

    # If action_type was mistakenly a transaction type, pivot to create_transaction and carry it along
    tx_type_from_action = None
    if action_type in {"regular", "one_time", "mortgage_interest"}:
        tx_type_from_action = action_type
        action_type = "create_transaction"
    elif action_type in {"credit", "debit"}:
        tx_type_from_action = "regular"
        action_type = "create_transaction"

    # Allow shorthand "transfer" as an action: treat as create_transaction with transfer subtype
    if action_type == "transfer":
        action["tx_type_internal"] = "transfer"
        action["double_entry"] = action.get("double_entry") or True
        action_type = "create_transaction"

    def resolve(value):
        if isinstance(value, str) and value.startswith("$"):
            return aliases.get(value[1:], value)
        return value

    if action_type == "create_scenario":
        if not action.get("name"):
            raise HTTPException(status_code=400, detail="Scenario name is required")
        _ensure_unique_scenario_name(current_user["id"], action["name"])
        # Parse start/end from start_date/end_date if provided
        if action.get("start_date") and (action.get("start_year") is None or action.get("start_month") is None):
            y, m = _parse_year_month_from_date(action.get("start_date"))
            if y:
                action["start_year"] = action.get("start_year") or y
            if m:
                action["start_month"] = action.get("start_month") or m
        if action.get("end_date") and (action.get("end_year") is None or action.get("end_month") is None):
            y, m = _parse_year_month_from_date(action.get("end_date"))
            if y:
                action["end_year"] = action.get("end_year") or y
            if m:
                action["end_month"] = action.get("end_month") or m
        # Fuzzy parse from start/end fields if provided as strings like "01/2026"
        if (action.get("start_year") is None or action.get("start_month") is None) and action.get("start"):
            y, m = _parse_year_month_fuzzy(str(action.get("start")))
            if y:
                action["start_year"] = action.get("start_year") or y
            if m:
                action["start_month"] = action.get("start_month") or m
        if (action.get("end_year") is None or action.get("end_month") is None) and action.get("end"):
            y, m = _parse_year_month_fuzzy(str(action.get("end")))
            if y:
                action["end_year"] = action.get("end_year") or y
            if m:
                action["end_month"] = action.get("end_month") or m
        payload = {
            "user_id": current_user["id"],
            "name": action.get("name"),
            "start_year": action.get("start_year"),
            "start_month": action.get("start_month"),
            "end_year": action.get("end_year"),
            "end_month": action.get("end_month"),
            "description": action.get("description"),
            "inflation_rate": action.get("inflation_rate"),
            "income_tax_rate": action.get("income_tax_rate")
            or action.get("income_tax")
            or action.get("einkommenssteuersatz")
            or action.get("steuersatz"),
            "wealth_tax_rate": action.get("wealth_tax_rate"),
        }
        required = ["name", "start_year", "start_month", "end_year", "end_month"]
        if any(payload.get(k) is None for k in required):
            raise HTTPException(status_code=400, detail="start_year/start_month and end_year/end_month required for create_scenario")
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
        scenario_doc = _ensure_scenario_access(scenario_id, current_user)
        initial_balance = (
            action.get("initial_balance")
            if action.get("initial_balance") is not None
            else action.get("balance")
            if action.get("balance") is not None
            else action.get("value")
            if action.get("value") is not None
            else 0.0
        )
        inferred_type = _normalize_asset_type(action.get("asset_type") or action.get("type"), action.get("name"))
        if not inferred_type:
            lname = (action.get("name") or "").lower()
            if any(k in lname for k in ["konto", "account", "zkb", "depot"]):
                inferred_type = "bank_account"
            elif any(k in lname for k in ["hypo", "hypothek"]):
                inferred_type = "mortgage"
            elif any(k in lname for k in ["haus", "immobilie", "house", "home"]):
                inferred_type = "real_estate"
        growth_rate = _parse_rate(action.get("annual_growth_rate") or action.get("growth_rate") or 0.0) or 0.0
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
        # Re-use existing asset if same name exists in scenario
        existing_assets = repo.list_assets_for_scenario(scenario_id)
        for existing in existing_assets:
            if existing.get("name") and existing["name"].lower() == name_value.lower():
                applied = existing
                if name_value and name_value not in aliases:
                    aliases[name_value] = existing.get("id")
                break
        if applied:
            return applied

        start_year = action.get("start_year") or (scenario_doc.get("start_year") if scenario_doc else None)
        start_month = action.get("start_month") or (scenario_doc.get("start_month") if scenario_doc else None)
        end_year = action.get("end_year") or (scenario_doc.get("end_year") if scenario_doc else None)
        end_month = action.get("end_month") or (scenario_doc.get("end_month") if scenario_doc else None)
        payload = {
            "name": name_value,
            "annual_growth_rate": growth_rate,
            "initial_balance": initial_balance,
            "asset_type": inferred_type or "generic",
            "start_year": start_year,
            "start_month": start_month,
            "end_year": end_year,
            "end_month": end_month,
        }
        _ensure_unique_asset_name(scenario_id, payload["name"])
        if not payload["start_year"] and action.get("purchase_date"):
            y, m = _parse_year_month_from_date(action.get("purchase_date"))
            payload["start_year"], payload["start_month"] = y, m
        if not payload["start_year"] and action.get("start_date"):
            y, m = _parse_year_month_from_date(action.get("start_date"))
            payload["start_year"], payload["start_month"] = y, m
        if scenario_doc:
            payload["start_year"] = payload["start_year"] or scenario_doc.get("start_year")
            payload["start_month"] = payload["start_month"] or scenario_doc.get("start_month")
            payload["end_year"] = payload["end_year"] or scenario_doc.get("end_year")
            payload["end_month"] = payload["end_month"] or scenario_doc.get("end_month")
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
        if state is not None and applied.get("id"):
            state["last_asset_id"] = applied.get("id")

    elif action_type == "update_asset":
        scenario_id = _resolve_scenario_id(action.get("scenario_id") or action.get("scenario"), current_user, aliases, last_scenario_id)
        _ensure_scenario_access(scenario_id, current_user)
        asset_id = _resolve_asset_id(action.get("asset_id") or action.get("name"), scenario_id, aliases)
        if not asset_id:
            raise HTTPException(status_code=404, detail="Asset not found to update")
        updates = {
            k: v
            for k, v in {
                "name": action.get("name"),
                "annual_growth_rate": _parse_rate(action.get("annual_growth_rate") or action.get("growth_rate")) if action.get("annual_growth_rate") is not None or action.get("growth_rate") is not None else None,
                "initial_balance": action.get("initial_balance"),
                "asset_type": action.get("asset_type"),
                "start_year": action.get("start_year"),
                "start_month": action.get("start_month"),
                "end_year": action.get("end_year"),
                "end_month": action.get("end_month"),
            }.items()
            if v is not None
        }
        if not updates:
            raise HTTPException(status_code=400, detail="No updates provided for update_asset")
        applied = repo.update_asset(asset_id, updates)
        if action.get("store_as"):
            aliases[action["store_as"]] = asset_id

    elif action_type == "create_liability":
        scenario_id = _resolve_scenario_id(action.get("scenario_id") or action.get("scenario"), current_user, aliases, last_scenario_id)
        scenario_doc = _ensure_scenario_access(scenario_id, current_user)
        name = action.get("name") or action.get("type") or "Liability"
        amount = action.get("amount") or 0.0
        interest_rate = _parse_rate(
            action.get("annual_interest_rate")
            or action.get("interest_rate")
            or action.get("zinssatz")
            or action.get("zins")
        )
        # Hypotheken bekommen keine Wachstumsrate; Zins gehört in mortgage_interest
        asset_growth_rate = 0.0
        start_year, start_month = _parse_year_month_from_date(action.get("start_date"))
        if scenario_doc:
            start_year = start_year or scenario_doc.get("start_year")
            start_month = start_month or scenario_doc.get("start_month")
        end_year = action.get("end_year") or (scenario_doc.get("end_year") if scenario_doc else None)
        end_month = action.get("end_month") or (scenario_doc.get("end_month") if scenario_doc else None)
        applied = repo.add_asset(
            scenario_id,
            name,
            asset_growth_rate,
            -abs(amount),
            "mortgage",
            start_year,
            start_month,
            end_year,
            end_month,
        )
        # store alias for liability/mortgage by name
        if name and name not in aliases:
            aliases[name] = applied.get("id")
        # track interest rate by mortgage asset id for later mortgage_interest transactions
        if interest_rates is not None and applied.get("id") and interest_rate is not None:
            interest_rates[applied.get("id")] = interest_rate
        if state is not None and applied.get("id"):
            state["last_mortgage_id"] = applied.get("id")
        # Auto-create mortgage interest transaction (payer = pay_from or first bank_account)
        try:
            payer_asset_id = (
                _resolve_asset_id(action.get("pay_from_asset_id") or action.get("pay_from_asset"), scenario_id, aliases)
                or _resolve_asset_id(action.get("asset_id"), scenario_id, aliases)
            )
            if not payer_asset_id:
                assets_in_scenario = repo.list_assets_for_scenario(scenario_id)
                bank = next((a for a in assets_in_scenario if a.get("asset_type") == "bank_account"), None)
                payer_asset_id = bank.get("id") if bank else None
            if payer_asset_id:
                scenario = repo.get_scenario(scenario_id)
                mi_start_year = start_year or scenario.get("start_year")
                mi_start_month = start_month or scenario.get("start_month")
                mi_end_year = action.get("end_year") or scenario.get("end_year")
                mi_end_month = action.get("end_month") or scenario.get("end_month")
                repo.add_transaction(
                    scenario_id,
                    payer_asset_id,
                    f"{name} Zins",
                    0.0,
                    "mortgage_interest",
                    mi_start_year,
                    mi_start_month,
                    mi_end_year,
                    mi_end_month,
                    action.get("frequency") or 1,
                    interest_rate or action.get("annual_growth_rate") or 0.0,
                    None,
                    False,
                    applied.get("id"),
                    interest_rate or action.get("annual_growth_rate") or 0.0,
                    action.get("taxable") or False,
                    action.get("taxable_amount"),
                )
        except Exception as exc:  # pragma: no cover
            print(f"[assistant] failed to auto-create mortgage interest tx: {exc}")

    elif action_type == "create_transaction":
        scenario_id = _resolve_scenario_id(action.get("scenario_id") or action.get("scenario"), current_user, aliases, last_scenario_id)
        _ensure_scenario_access(scenario_id, current_user)
        scenario = repo.get_scenario(scenario_id)
        if not scenario:
            raise HTTPException(status_code=404, detail="Scenario not found for create_transaction")
        asset_id = _resolve_asset_id(action.get("asset_id") or action.get("from_asset"), scenario_id, aliases)
        # If a counter asset is present, default to double_entry
        if not action.get("double_entry") and (action.get("counter_asset_id") or action.get("to_asset")):
            action["double_entry"] = True
        if not asset_id:
            # fallback: last created asset in state
            if state is not None:
                asset_id = state.get("last_asset_id")
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

        tx_type = _normalize_tx_type(
            tx_type_from_action
            or action.get("tx_type_internal")
            or action.get("tx_type")
            or action.get("transaction_type")
            or action.get("tx_kind")
            or action.get("type")
            or "one_time"
        )
        if tx_type == "transfer":
            tx_type = "regular"
        # Default mortgage_asset_id from last created mortgage if missing
        if tx_type == "mortgage_interest" and not action.get("mortgage_asset_id") and state is not None:
            action["mortgage_asset_id"] = state.get("last_mortgage_id")
        if tx_type == "mortgage_interest":
            action["double_entry"] = False

        # Mortgage interest-specific normalisation
        if tx_type == "mortgage_interest":
            # If annual_interest_rate is missing but amount looks like a rate (0 < amount <= 1), treat amount as rate and set amount to 0 (computed later)
            if (action.get("annual_interest_rate") is None and action.get("interest_rate") is None and action.get("zinssatz") is None):
                amt = action.get("amount")
                try:
                    amt_f = float(amt)
                except Exception:
                    amt_f = None
                if amt_f is not None and 0 < amt_f <= 1:
                    action["annual_interest_rate"] = amt_f
                    action["amount"] = 0.0
            # Ensure frequency defaults to monthly if not provided
            action["frequency"] = action.get("frequency") or 1

            # If mortgage_asset_id missing but asset is a mortgage, treat it as the mortgage and look for a payer
            if not action.get("mortgage_asset_id") and asset and asset.get("asset_type") == "mortgage":
                action["mortgage_asset_id"] = asset_id
                # payer fallback: pay_from_asset, last_asset_id, or first bank account
                payer_candidate = _resolve_asset_id(action.get("pay_from_asset") or action.get("pay_from_asset_id"), scenario_id, aliases)
                if not payer_candidate and state is not None:
                    payer_candidate = state.get("last_asset_id")
                if not payer_candidate:
                    assets_in_scenario = repo.list_assets_for_scenario(scenario_id)
                    bank = next((a for a in assets_in_scenario if a.get("asset_type") == "bank_account"), None)
                    payer_candidate = bank.get("id") if bank else None
                if payer_candidate:
                    asset_id = payer_candidate

        # Prefer explicit dates; fall back to scenario defaults
        start_year = None
        start_month = None
        if action.get("start_date"):
            y, m = _parse_year_month_from_date(action.get("start_date"))
            start_year, start_month = y, m
        if start_year is None:
            start_year = action.get("start_year") or scenario.get("start_year")
        if start_month is None:
            start_month = action.get("start_month") or scenario.get("start_month")

        end_year = None
        end_month = None
        if action.get("end_date"):
            y, m = _parse_year_month_from_date(action.get("end_date"))
            end_year, end_month = y, m
        if end_year is None:
            end_year = action.get("end_year") or scenario.get("end_year")
        if end_month is None:
            end_month = action.get("end_month") or scenario.get("end_month")

        annual_interest_rate = _parse_rate(
            action.get("annual_interest_rate")
            or action.get("interest_rate")
            or action.get("zinssatz")
            or action.get("zins")
        )
        if tx_type in {"mortgage_interest", "zinsausgaben"}:
            # Require mortgage and rate; no fallback to growth
            if annual_interest_rate is None and interest_rates and action.get("mortgage_asset_id"):
                annual_interest_rate = interest_rates.get(action.get("mortgage_asset_id"))
            if not action.get("mortgage_asset_id") and state is not None:
                action["mortgage_asset_id"] = state.get("last_mortgage_id")
            if action.get("mortgage_asset_id") is None:
                raise HTTPException(status_code=400, detail="mortgage_asset_id required for mortgage_interest")
            if annual_interest_rate is None:
                raise HTTPException(status_code=400, detail="annual_interest_rate required for mortgage_interest")
            action["amount"] = 0.0
            if action.get("frequency") is None:
                action["frequency"] = 1
        tx_name = action.get("name") or "AI Transaction"
        overwrite = action.get("overwrite") or action.get("overwrite_existing") or action.get("replace")
        if overwrite:
            _delete_transactions_by_name(scenario_id, tx_name)
        growth_rate_raw = action.get("annual_growth_rate") or action.get("growth_rate")
        growth_rate = _parse_rate(growth_rate_raw) if growth_rate_raw is not None else None
        # If a transaction with the same name exists and no overwrite flag, perform update instead of failing
        existing_tx_id = _resolve_transaction_id(tx_name, scenario_id, aliases)
        if existing_tx_id and not overwrite:
            tx = repo.get_transaction(existing_tx_id)
            if not tx:
                raise HTTPException(status_code=404, detail="Transaction not found to update")
            # Build updates using provided values, falling back to existing data
            updates = {
                k: v
                for k, v in {
                    "name": tx_name,
                    "amount": action.get("amount"),
                    "type": tx_type or tx.get("type"),
                    "start_year": start_year,
                    "start_month": start_month,
                    "end_year": end_year,
                    "end_month": end_month,
                    "frequency": action.get("frequency"),
                    "annual_growth_rate": growth_rate if growth_rate is not None else tx.get("annual_growth_rate"),
                    "asset_id": asset_id or tx.get("asset_id"),
                    "counter_asset_id": action.get("counter_asset_id"),
                    "double_entry": action.get("double_entry"),
                    "mortgage_asset_id": action.get("mortgage_asset_id"),
                    "annual_interest_rate": annual_interest_rate,
                    "taxable": action.get("taxable") if action.get("taxable") is not None else tx.get("taxable"),
                    "taxable_amount": action.get("taxable_amount"),
                }.items()
                if v is not None
            }
            applied = repo.update_transaction(existing_tx_id, updates)
            return applied
        _ensure_unique_transaction_name(scenario_id, tx_name)
        if action.get("double_entry"):
            counter_asset_id = _resolve_asset_id(action.get("counter_asset_id") or action.get("to_asset_id") or action.get("to_asset"), scenario_id, aliases)
            if not counter_asset_id:
                raise HTTPException(status_code=400, detail="counter_asset_id (or to_asset_id) required for double_entry")
            if counter_asset_id == asset_id:
                raise HTTPException(status_code=400, detail="counter_asset_id must differ from asset_id")
            # debit_tx = receiver (positive), credit_tx = payer (negative)
            debit_tx, credit_tx = repo.add_linked_transactions(
                scenario_id,
                counter_asset_id,
                asset_id,
                tx_name,
                action.get("amount") or 0.0,
                tx_type,
                start_year,
                start_month,
                end_year or start_year,
                end_month or start_month,
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
                end_year or start_year,
                end_month or start_month,
                action.get("frequency"),
                growth_rate if growth_rate is not None else 0.0,
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
    elif action_type in {"update_transaction", "upsert_transaction"}:
        scenario_id = _resolve_scenario_id(action.get("scenario_id") or action.get("scenario"), current_user, aliases, last_scenario_id)
        _ensure_scenario_access(scenario_id, current_user)
        tx_ref = action.get("transaction_id") or action.get("name")
        if not tx_ref:
            raise HTTPException(status_code=400, detail="transaction_id or name required for update_transaction")
        tx = _resolve_transaction_by_ref(scenario_id, tx_ref, aliases)
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found to update")
        tx_type = (
            action.get("tx_type_internal")
            or action.get("tx_type_from_action")
            or action.get("tx_type")
            or action.get("transaction_type")
            or action.get("tx_kind")
            or action.get("type_tx")  # avoid clashing with action.type
            or tx.get("type")
        )

        # Localize/normalize tax flags
        taxable_flag = action.get("taxable")
        if taxable_flag is None:
            taxable_flag = action.get("steuerbar")
        if taxable_flag is None:
            taxable_flag = action.get("steuerrelevant")
        taxable_amount = action.get("taxable_amount")
        if taxable_amount is None:
            taxable_amount = action.get("steuerbetrag")

        updates = {
            k: v
            for k, v in {
                "name": action.get("name") or tx.get("name"),
                "amount": action.get("amount"),
                "type": tx_type,
                "start_year": action.get("start_year"),
                "start_month": action.get("start_month"),
                "end_year": action.get("end_year"),
                "end_month": action.get("end_month"),
                "frequency": action.get("frequency"),
                "annual_growth_rate": _parse_rate(action.get("annual_growth_rate")) if action.get("annual_growth_rate") is not None else None,
                "asset_id": _resolve_asset_id(action.get("asset_id") or action.get("from_asset"), scenario_id, aliases) or tx.get("asset_id"),
                "counter_asset_id": _resolve_asset_id(action.get("counter_asset_id") or action.get("to_asset"), scenario_id, aliases),
                "double_entry": action.get("double_entry"),
                "mortgage_asset_id": _resolve_asset_id(action.get("mortgage_asset_id"), scenario_id, aliases),
                "annual_interest_rate": _parse_rate(action.get("annual_interest_rate") or action.get("interest_rate") or action.get("zinssatz") or action.get("zins")) if action.get("annual_interest_rate") is not None or action.get("interest_rate") is not None or action.get("zinssatz") is not None or action.get("zins") is not None else tx.get("annual_interest_rate"),
                "taxable": taxable_flag,
                "taxable_amount": taxable_amount,
            }.items()
            if v is not None
        }
        applied = repo.update_transaction(tx["id"], updates)
        # If this is a linked double-entry transaction, mirror updates to the counterpart
        if tx.get("link_id"):
            sibling = None
            try:
                sibling = repo.db.transactions.find_one({"link_id": tx.get("link_id"), "_id": {"$ne": tx["id"]}})
            except Exception:
                sibling = None
            if sibling:
                sibling_updates = updates.copy()
                # Swap asset/counter if provided
                if updates.get("asset_id") or updates.get("counter_asset_id"):
                    sibling_updates["asset_id"] = updates.get("counter_asset_id") or sibling.get("asset_id")
                    sibling_updates["counter_asset_id"] = updates.get("asset_id") or sibling.get("counter_asset_id")
                # Mirror name and schedule fields
                sibling_updates["name"] = updates.get("name") or sibling.get("name")
                sibling_updates["start_year"] = updates.get("start_year") or sibling.get("start_year")
                sibling_updates["start_month"] = updates.get("start_month") or sibling.get("start_month")
                sibling_updates["end_year"] = updates.get("end_year") or sibling.get("end_year")
                sibling_updates["end_month"] = updates.get("end_month") or sibling.get("end_month")
                sibling_updates["frequency"] = updates.get("frequency") or sibling.get("frequency")
                sibling_updates["annual_growth_rate"] = updates.get("annual_growth_rate") if "annual_growth_rate" in updates else sibling.get("annual_growth_rate")
                sibling_updates["annual_interest_rate"] = updates.get("annual_interest_rate") if "annual_interest_rate" in updates else sibling.get("annual_interest_rate")
                sibling_updates["taxable"] = updates.get("taxable") if "taxable" in updates else sibling.get("taxable")
                sibling_updates["taxable_amount"] = updates.get("taxable_amount") if "taxable_amount" in updates else sibling.get("taxable_amount")
                repo.update_transaction(sibling["_id"], sibling_updates)
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
       "Du bist der Orchestrator (einziger Sprecher). Spezial-Agenten: Szenario, Konto, Immo, Hypo. "
       "Zins-Agent: stellt sicher, dass mortgage_interest Transaktionen alle Pflichtfelder haben (Zahler, Hypothek, Zinssatz, Frequency, Start/Ende). Nach dem Anlegen einer Hypothek fragt der Orchestrator, ob der Zins-Agent direkt eine Zinstransaktion anlegen soll, und instruiert ihn bei Zustimmung mit den bekannten Feldern. "
       "Strikte API-Kurzreferenz, keine Felder erfinden. Fehlende Pflichtfelder zuerst erfragen, dann zusammenfassen, dann ausführen. Aktionen als Warteschlange.\n"
        "1) Kontext: nur aktueller Nutzer/Szenario. use_scenario für Wechsel, fehlendes Szenario neu anlegen. "
        "   Wenn ein Immobilien-Asset (Haus/Immobilie) angelegt wird und keine Hypothek genannt ist, frage kurz, ob eine Hypothek mitfinanziert werden soll. "
        "2) Pflichtfelder je Aktion (erst erfragen, dann planen): "
         "   - use_scenario: scenario (Name/ID), sonst aktuelles. "
         "   - create_scenario: name, start_year/month, end_year/month. "
         "   - create_asset (Konto/Immo): scenario, name, annual_growth_rate (bei Konto als Verzinsung/Zins benennen; immer abfragen, nicht defaulten), initial_balance (default 0), asset_type (ableiten: Konto/Depot→bank_account, Haus/Immobilie→real_estate). "
         "   - create_liability (Hypothek): scenario, name, amount, start; Zinssatz NICHT als Growth, sondern für mortgage_interest nutzen. "
       "   - create_transaction: scenario, asset_id, name, amount, type, start_year/start_month (oder start_date). "
         "     mortgage_interest Pflicht: asset_id (Zahler), mortgage_asset_id (Hypothek), annual_interest_rate/interest_rate/zinssatz, frequency, start_year/start_month. Betrag kann 0 sein (wird berechnet). "
         "     Fehlt etwas: nachfragen, NICHT ausführen, NICHT auf regular fallbacken. Namen/Aliase im Szenario auflösen, bevor du fragst. "
         "     Transfer/Umbuchung: double_entry=true, asset_id=Zahler, counter_asset_id=Empfänger, amount, start_date/start_year/start_month; tx_type=one_time oder regular. "
         "   - create_interest_transaction ist eine Kurzform von create_transaction mit tx_type=mortgage_interest (Zahler, Hypothek, Zins, Frequency, Start/End). "
         "   - Kombi Immo+Hypo+Zins: 1) Asset (real_estate) anlegen, 2) Hypothek anlegen (ohne Growth), 3) Zins-Transaktion (mortgage_interest) mit Zahler-Konto, mortgage_asset_id, Zinssatz, Frequency, Start/Ende. Reihenfolge einhalten; nach fehlenden Feldern fragen. "
         "   - update_asset: scenario, asset_id (Name/ID/Alias), optionale Felder. "
         "   - delete_*: scenario + Name/ID/Alias. "
        "3) Wenn alles da ist: tabellarisch/kurz zusammenfassen (kein JSON), Zustimmung einholen; auto_apply erst nach Zustimmung. "
        "4) JSON-Plan IMMER in ```json``` Schema: { \"auto_apply\": true|false, \"actions\": [ { \"type\": \"use_scenario|create_scenario|create_asset|update_asset|create_liability|create_transaction|update_transaction|delete_asset|delete_liability|delete_transaction\", "
        "\"scenario\"|\"scenario_id\": \"...\", optional \"store_as\": \"alias\", Felder wie name, amount, start_date, initial_balance, asset_type, interest_rate usw. } ] }. "
        "Aliase ($alias) nutzen. Wenn noch Daten fehlen oder keine Zustimmung: nachfragen und auto_apply=false lassen. "
        "Antworte kurz, kein 'ich kann nur Pläne erstellen'. "
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
    should_auto_apply = False
    # Normalize plan: lift auto_apply from misplaced action entries, clean actions
    if plan and isinstance(plan, dict):
        actions = plan.get("actions")
        if isinstance(actions, list):
            cleaned_actions = []
            for a in actions:
                if isinstance(a, dict) and "auto_apply" in a and "type" not in a:
                    # Treat as misplaced flag
                    plan["auto_apply"] = plan.get("auto_apply") or bool(a.get("auto_apply"))
                    continue
                cleaned_actions.append(a)
            plan["actions"] = cleaned_actions
        # Pre-flight validation first: if required fields missing, ask and do not apply
        missing_msgs = _validate_actions(actions or [])
        if missing_msgs:
            missing_text = "; ".join(missing_msgs)
            assistant_reply = f"Folgende Pflichtfelder fehlen/ungenau: {missing_text}\nBitte die fehlenden Angaben nennen, dann führe ich es aus."
            assistant_msg = AssistantMessage(role="assistant", content=assistant_reply)
            updated_messages = payload.messages + [assistant_msg]
            # ensure no auto apply when missing
            return AssistantChatResponse(messages=updated_messages, plan=None, reply=assistant_reply)

        # Only auto-apply if explicitly requested
        should_auto_apply = bool(plan.get("auto_apply") or (payload.context or {}).get("auto_apply"))
        # Heuristic: if user just confirmed (ja/ok/ausführen) and plan has actions, auto-apply
        if not should_auto_apply and actions:
            last_user_msg = next((m for m in reversed(payload.messages) if m.role == "user"), None)
            if last_user_msg and isinstance(last_user_msg.content, str):
                txt = last_user_msg.content.strip().lower()
                if any(word in txt for word in ["ja", "okay", "ok", "mach", "ausführen", "bitte", "go", "erstellen", "anlegen", "jetzt", "starten"]):
                    should_auto_apply = True
                    plan["auto_apply"] = True

    if plan and isinstance(plan, dict) and isinstance(plan.get("actions"), list) and len(plan["actions"]) > 0 and should_auto_apply:
        try:
            # prefer context scenario if provided
            ctx = payload.context or {}
            initial_scenario_ref = ctx.get("scenario_id") or ctx.get("scenario_name")
            applied_results = _apply_plan(plan, current_user, initial_scenario_ref=initial_scenario_ref)
            print(f"[assistant] applied {len(applied_results)} actions")
        except HTTPException as exc:
            # Friendly recovery for missing inputs (e.g. asset_id not provided)
            detail_text = str(exc.detail).lower()
            missing_question = None
            if "asset_id required" in detail_text:
                missing_question = "Für die Transaktion brauche ich ein Konto/Asset. Welches Konto oder Asset soll ich verwenden?"
            if "scenario name is required" in detail_text or "missing fields for create_scenario" in detail_text:
                missing_question = "Bitte nenne das Szenario (Name)."
            if "start_year" in detail_text or "start_month" in detail_text or "start_year/start_month" in detail_text:
                missing_question = "Bitte gib Start- und Enddatum für das Szenario an (Monat/Jahr), z.B. Start 01/2026, Ende 12/2050."
            if "transaction name" in detail_text and "already exists" in detail_text:
                missing_question = (
                    "Es gibt schon eine Transaktion mit diesem Namen. Soll ich sie aktualisieren (update_transaction) "
                    "oder die bestehende überschreiben (overwrite=true)?"
                )
            if missing_question:
                assistant_reply = f"{reply}\n\n{missing_question}"
                assistant_msg = AssistantMessage(role="assistant", content=assistant_reply)
                updated_messages = payload.messages + [assistant_msg]
                return AssistantChatResponse(messages=updated_messages, plan=plan, reply=assistant_reply)

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

    # If wir auto-applied, Plan leeren; ansonsten Plan zurückgeben (manuelle Bestätigung möglich)
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
    interest_rates: Dict[str, float] = {}
    state: Dict[str, Any] = {}
    last_scenario_id = _resolve_scenario_id(initial_scenario_ref, current_user, aliases, None)
    for action in actions:
        if not isinstance(action, dict):
            continue
        applied_item = _apply_plan_action(action, current_user, aliases, last_scenario_id, interest_rates, state)
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
