from __future__ import annotations

import os
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator

from .repository import WealthRepository
from .services import run_scenario_simulation

app = FastAPI(title="Wealth Planner API", version="0.1.0")

allowed_origins = os.getenv("CORS_ALLOW_ORIGINS", "*")
if allowed_origins == "*":
    origins = ["*"]
else:
    origins = [origin.strip() for origin in allowed_origins.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)

repo = WealthRepository()


class UserCreate(BaseModel):
    name: str
    email: str


class ScenarioCreate(BaseModel):
    user_id: str = Field(..., description="Owner of the scenario")
    name: str
    description: Optional[str] = None
    start_year: int = Field(..., ge=1900)
    start_month: int = Field(..., ge=1, le=12)
    end_year: int = Field(..., ge=1900)
    end_month: int = Field(..., ge=1, le=12)

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


@app.post("/users")
def create_user(user: UserCreate):
    return repo.create_user(user.name, user.email)


@app.get("/users")
def list_users():
    return repo.list_users()


@app.post("/scenarios")
def create_scenario(payload: ScenarioCreate):
    user = repo.get_user(payload.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return repo.create_scenario(
        payload.user_id,
        payload.name,
        payload.start_year,
        payload.start_month,
        payload.end_year,
        payload.end_month,
        payload.description,
    )


@app.get("/users/{user_id}/scenarios")
def list_user_scenarios(user_id: str):
    return repo.list_scenarios_for_user(user_id)


@app.get("/scenarios/{scenario_id}")
def get_scenario(scenario_id: str):
    scenario = repo.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return scenario


@app.patch("/scenarios/{scenario_id}")
def update_scenario(scenario_id: str, payload: ScenarioUpdate):
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates supplied")
    scenario = repo.update_scenario(scenario_id, updates)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return scenario


@app.delete("/scenarios/{scenario_id}")
def delete_scenario(scenario_id: str):
    deleted = repo.delete_scenario(scenario_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return {"status": "deleted"}


@app.post("/scenarios/{scenario_id}/assets")
def create_asset(scenario_id: str, payload: AssetCreate):
    scenario = repo.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
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
def list_assets(scenario_id: str):
    return repo.list_assets_for_scenario(scenario_id)


@app.patch("/assets/{asset_id}")
def update_asset(asset_id: str, payload: AssetUpdate):
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates supplied")
    asset = repo.update_asset(asset_id, updates)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


@app.delete("/assets/{asset_id}")
def delete_asset(asset_id: str):
    deleted = repo.delete_asset(asset_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"status": "deleted"}


@app.post("/scenarios/{scenario_id}/transactions")
def create_transaction(scenario_id: str, payload: TransactionCreate):
    scenario = repo.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
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
    )


@app.get("/scenarios/{scenario_id}/transactions")
def list_transactions(scenario_id: str):
    return repo.list_transactions_for_scenario(scenario_id)


@app.patch("/transactions/{transaction_id}")
def update_transaction(transaction_id: str, payload: TransactionUpdate):
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates supplied")
    transaction = repo.update_transaction(transaction_id, updates)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return transaction


@app.delete("/transactions/{transaction_id}")
def delete_transaction(transaction_id: str):
    deleted = repo.delete_transaction(transaction_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return {"status": "deleted"}


@app.post("/scenarios/{scenario_id}/simulate")
def simulate_scenario(scenario_id: str):
    try:
        return run_scenario_simulation(scenario_id, repo)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
