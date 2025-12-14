from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from bson import ObjectId
from pymongo import ReturnDocument

from .database import get_database


def _hash_password(password: str) -> str:
    """Return PBKDF2 salted hash."""
    salt = secrets.token_bytes(16)
    iterations = 100_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"{iterations}${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def _verify_password(password: str, encoded: str) -> bool:
    try:
        iterations_str, salt_b64, digest_b64 = encoded.split("$")
        iterations = int(iterations_str)
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
    except (ValueError, TypeError, base64.binascii.Error):
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(expected, digest)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _ensure_object_id(value: Any) -> ObjectId:
    if isinstance(value, ObjectId):
        return value
    return ObjectId(str(value))


def _ensure_optional_object_id(value: Any) -> Optional[ObjectId]:
    """Return an ObjectId or None for falsy inputs."""
    if value in (None, "", 0):
        return None
    return _ensure_object_id(value)


def _serialize(document: Dict[str, Any]) -> Dict[str, Any]:
    if not document:
        return document
    doc = document.copy()
    doc["id"] = str(doc.pop("_id"))
    for key, val in list(doc.items()):
        if isinstance(val, ObjectId):
            doc[key] = str(val)
    return doc


def _serialize_user(document: Dict[str, Any]) -> Dict[str, Any]:
    doc = _serialize(document)
    if doc:
        doc.pop("password_hash", None)
        doc.pop("auth_token_hash", None)
    return doc


def _round_two_decimals(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    return round(float(value), 2)


def _normalize_tariff_rows(rows: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for row in rows or []:
        threshold = float(row.get("threshold", 0.0) or 0.0)
        base_amount = _round_two_decimals(row.get("base_amount", 0.0) or 0.0) or 0.0
        per_100_amount = _round_two_decimals(row.get("per_100_amount", 0.0) or 0.0) or 0.0
        normalized.append(
            {
                "threshold": threshold,
                "base_amount": base_amount,
                "per_100_amount": per_100_amount,
                "note": row.get("note"),
            }
        )
    return normalized


class WealthRepository:
    """Data access layer for users, assets, transactions, and scenarios."""

    def __init__(self, db=None):
        self.db = db or get_database()

    # Users -----------------------------------------------------------------
    def create_user(self, username: str, password: str, name: str | None, email: str | None) -> Dict[str, Any]:
        if self.db.users.find_one({"username": username}):
            raise ValueError("Username already exists")
        doc = {
            "username": username,
            "password_hash": _hash_password(password),
            "name": name,
            "email": email,
            "created_at": datetime.utcnow(),
        }
        result = self.db.users.insert_one(doc)
        doc["_id"] = result.inserted_id
        return _serialize_user(doc)

    def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        doc = self.db.users.find_one({"_id": _ensure_object_id(user_id)})
        return _serialize_user(doc) if doc else None

    def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        doc = self.db.users.find_one({"username": username})
        return _serialize_user(doc) if doc else None

    def get_user_with_secret_fields(self, username: str) -> Optional[Dict[str, Any]]:
        """Internal helper to retrieve user with password/token hashes."""
        doc = self.db.users.find_one({"username": username})
        if not doc:
            return None
        doc = _serialize(doc)
        return doc

    def list_users(self) -> List[Dict[str, Any]]:
        # Expose only sanitized data; callers should additionally scope to current user.
        return [_serialize_user(doc) for doc in self.db.users.find()]

    def authenticate_user(self, username: str, password: str) -> Optional[Dict[str, Any]]:
        record = self.get_user_with_secret_fields(username)
        if not record:
            return None
        password_hash = record.pop("password_hash", None)
        if not password_hash or not _verify_password(password, password_hash):
            return None
        record.pop("auth_token_hash", None)
        return record

    def issue_auth_token(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        token_hash = _hash_token(token)
        updated = self.db.users.find_one_and_update(
            {"_id": _ensure_object_id(user_id)},
            {"$set": {"auth_token_hash": token_hash}},
            return_document=ReturnDocument.AFTER,
        )
        if not updated:
            raise ValueError("User not found")
        return token

    def get_user_by_token(self, token: str) -> Optional[Dict[str, Any]]:
        token_hash = _hash_token(token)
        doc = self.db.users.find_one({"auth_token_hash": token_hash})
        return _serialize_user(doc) if doc else None

    def delete_user(self, user_id: str) -> bool:
        user_oid = _ensure_object_id(user_id)
        scenarios = list(self.db.scenarios.find({"user_id": user_oid}, {"_id": 1}))
        for scenario in scenarios:
            self.delete_scenario(str(scenario["_id"]))
        result = self.db.users.delete_one({"_id": user_oid})
        return result.deleted_count > 0

    # Scenarios -------------------------------------------------------------
    def create_scenario(
        self,
        user_id: str,
        name: str,
        start_year: int,
        start_month: int,
        end_year: int,
        end_month: int,
        description: str | None = None,
        inflation_rate: float | None = None,
        income_tax_rate: float | None = None,
        wealth_tax_rate: float | None = None,
        municipal_tax_factor: float | None = None,
        cantonal_tax_factor: float | None = None,
        church_tax_factor: float | None = None,
        personal_tax_per_person: float | None = None,
        tax_account_id: str | None = None,
        tax_canton: str | None = None,
        tax_municipality_id: str | None = None,
        tax_municipality_name: str | None = None,
        tax_state_income_tariff_id: str | None = None,
        tax_state_wealth_tariff_id: str | None = None,
        tax_federal_tariff_id: str | None = None,
        tax_confession: str | None = None,
    ) -> Dict[str, Any]:
        doc = {
            "user_id": _ensure_object_id(user_id),
            "name": name,
            "description": description,
            "start_year": start_year,
            "start_month": start_month,
            "end_year": end_year,
            "end_month": end_month,
            "created_at": datetime.utcnow(),
            "inflation_rate": inflation_rate,
            "income_tax_rate": income_tax_rate,
            "wealth_tax_rate": wealth_tax_rate,
            "municipal_tax_factor": municipal_tax_factor,
            "cantonal_tax_factor": cantonal_tax_factor,
            "church_tax_factor": church_tax_factor,
            "personal_tax_per_person": personal_tax_per_person,
            "tax_account_id": _ensure_object_id(tax_account_id) if tax_account_id else None,
            "tax_canton": tax_canton,
            "tax_municipality_id": _ensure_object_id(tax_municipality_id)
            if tax_municipality_id
            else None,
            "tax_municipality_name": tax_municipality_name,
            "tax_state_income_tariff_id": _ensure_object_id(tax_state_income_tariff_id)
            if tax_state_income_tariff_id
            else None,
            "tax_state_wealth_tariff_id": _ensure_object_id(tax_state_wealth_tariff_id)
            if tax_state_wealth_tariff_id
            else None,
            "tax_federal_tariff_id": _ensure_object_id(tax_federal_tariff_id)
            if tax_federal_tariff_id
            else None,
            "tax_confession": tax_confession,
        }
        res = self.db.scenarios.insert_one(doc)
        doc["_id"] = res.inserted_id
        return _serialize(doc)

    def get_scenario(self, scenario_id: str) -> Optional[Dict[str, Any]]:
        doc = self.db.scenarios.find_one({"_id": _ensure_object_id(scenario_id)})
        return _serialize(doc) if doc else None

    def list_scenarios_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        return [
            _serialize(doc)
            for doc in self.db.scenarios.find({"user_id": _ensure_object_id(user_id)})
        ]

    def update_scenario(self, scenario_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        object_id_fields = {
            "user_id",
            "tax_account_id",
            "tax_municipality_id",
            "tax_state_income_tariff_id",
            "tax_state_wealth_tariff_id",
            "tax_federal_tariff_id",
        }
        converted_updates = {
            k: _ensure_optional_object_id(v) if k in object_id_fields else v for k, v in updates.items()
        }
        doc = self.db.scenarios.find_one_and_update(
            {"_id": _ensure_object_id(scenario_id)},
            {"$set": converted_updates},
            return_document=ReturnDocument.AFTER,
        )
        return _serialize(doc) if doc else None

    def delete_scenario(self, scenario_id: str) -> bool:
        scenario_oid = _ensure_object_id(scenario_id)
        result = self.db.scenarios.delete_one({"_id": scenario_oid})
        if result.deleted_count:
            self.db.assets.delete_many({"scenario_id": scenario_oid})
            self.db.transactions.delete_many({"scenario_id": scenario_oid})
        return result.deleted_count > 0

    # Assets ----------------------------------------------------------------
    def add_asset(
        self,
        scenario_id: str,
        name: str,
        annual_growth_rate: float,
        initial_balance: float = 0.0,
        asset_type: str = "generic",
        start_year: int | None = None,
        start_month: int | None = None,
        end_year: int | None = None,
        end_month: int | None = None,
    ) -> Dict[str, Any]:
        doc = {
            "scenario_id": _ensure_object_id(scenario_id),
            "name": name,
            "annual_growth_rate": annual_growth_rate,
            "initial_balance": initial_balance,
            "asset_type": asset_type,
            "start_year": start_year,
            "start_month": start_month,
            "end_year": end_year,
            "end_month": end_month,
            "created_at": datetime.utcnow(),
        }
        res = self.db.assets.insert_one(doc)
        doc["_id"] = res.inserted_id
        return _serialize(doc)

    def list_assets_for_scenario(self, scenario_id: str) -> List[Dict[str, Any]]:
        return [
            _serialize(doc)
            for doc in self.db.assets.find({"scenario_id": _ensure_object_id(scenario_id)})
        ]

    def get_asset(self, asset_id: str) -> Optional[Dict[str, Any]]:
        doc = self.db.assets.find_one({"_id": _ensure_object_id(asset_id)})
        return _serialize(doc) if doc else None

    def update_asset(self, asset_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        doc = self.db.assets.find_one_and_update(
            {"_id": _ensure_object_id(asset_id)},
            {"$set": updates},
            return_document=ReturnDocument.AFTER,
        )
        return _serialize(doc) if doc else None

    def delete_asset(self, asset_id: str) -> bool:
        asset_oid = _ensure_object_id(asset_id)
        asset = self.db.assets.find_one({"_id": asset_oid})
        if not asset:
            return False

        link_ids = {
            doc.get("link_id")
            for doc in self.db.transactions.find(
                {"asset_id": asset_oid, "link_id": {"$exists": True}}
            )
            if doc.get("link_id")
        }

        self.db.assets.delete_one({"_id": asset_oid})
        self.db.transactions.delete_many(
            {
                "$or": [
                    {"asset_id": asset_oid},
                    {"counter_asset_id": asset_oid},
                    {"mortgage_asset_id": asset_oid},
                ]
            }
        )
        if link_ids:
            self.db.transactions.delete_many({"link_id": {"$in": list(link_ids)}})

        return True

    # Transactions ----------------------------------------------------------
    def add_transaction(
        self,
        scenario_id: str,
        asset_id: str,
        name: str,
        amount: float,
        transaction_type: str,
        start_year: int,
        start_month: int,
        end_year: Optional[int] = None,
        end_month: Optional[int] = None,
        frequency: Optional[int] = None,
        annual_growth_rate: float = 0.0,
        counter_asset_id: Optional[str] = None,
        link_id: Optional[str] = None,
        double_entry: bool = False,
        mortgage_asset_id: Optional[str] = None,
        annual_interest_rate: Optional[float] = None,
        taxable: bool = False,
        taxable_amount: Optional[float] = None,
        correction: bool = False,
    ) -> Dict[str, Any]:
        doc = {
            "scenario_id": _ensure_object_id(scenario_id),
            "asset_id": _ensure_object_id(asset_id),
            "name": name,
            "amount": amount,
            "type": transaction_type,
            "start_year": start_year,
            "start_month": start_month,
            "end_year": end_year,
            "end_month": end_month,
            "frequency": frequency,
            "annual_growth_rate": annual_growth_rate,
            "annual_interest_rate": annual_interest_rate,
            "created_at": datetime.utcnow(),
            "double_entry": double_entry,
            "taxable": taxable,
            "correction": bool(correction),
        }
        if counter_asset_id:
            doc["counter_asset_id"] = _ensure_object_id(counter_asset_id)
        if link_id:
            doc["link_id"] = link_id
        if mortgage_asset_id:
            doc["mortgage_asset_id"] = _ensure_object_id(mortgage_asset_id)
        if taxable_amount is not None:
            doc["taxable_amount"] = taxable_amount
        res = self.db.transactions.insert_one(doc)
        doc["_id"] = res.inserted_id
        return _serialize(doc)

    def add_linked_transactions(
        self,
        scenario_id: str,
        debit_asset_id: str,
        credit_asset_id: str,
        name: str,
        amount: float,
        transaction_type: str,
        start_year: int,
        start_month: int,
        end_year: Optional[int] = None,
        end_month: Optional[int] = None,
        frequency: Optional[int] = None,
        annual_growth_rate: float = 0.0,
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        link_id = str(ObjectId())
        base = {
            "scenario_id": _ensure_object_id(scenario_id),
            "name": name,
            "type": transaction_type,
            "start_year": start_year,
            "start_month": start_month,
            "end_year": end_year,
            "end_month": end_month,
            "frequency": frequency,
            "annual_growth_rate": annual_growth_rate,
            "created_at": datetime.utcnow(),
            "double_entry": True,
            "link_id": link_id,
        }
        debit_doc = {
            **base,
            "asset_id": _ensure_object_id(debit_asset_id),
            "counter_asset_id": _ensure_object_id(credit_asset_id),
            "amount": amount,
            "entry": "debit",
        }
        credit_doc = {
            **base,
            "asset_id": _ensure_object_id(credit_asset_id),
            "counter_asset_id": _ensure_object_id(debit_asset_id),
            "amount": -amount,
            "entry": "credit",
        }

        result = self.db.transactions.insert_many([debit_doc, credit_doc])
        debit_doc["_id"], credit_doc["_id"] = result.inserted_ids
        return _serialize(debit_doc), _serialize(credit_doc)

    def list_transactions_for_scenario(self, scenario_id: str) -> List[Dict[str, Any]]:
        return [
            _serialize(doc)
            for doc in self.db.transactions.find({"scenario_id": _ensure_object_id(scenario_id)})
        ]

    def list_transactions_for_asset(self, asset_id: str) -> List[Dict[str, Any]]:
        return [
            _serialize(doc)
            for doc in self.db.transactions.find({"asset_id": _ensure_object_id(asset_id)})
        ]

    def get_transaction(self, transaction_id: str) -> Optional[Dict[str, Any]]:
        doc = self.db.transactions.find_one({"_id": _ensure_object_id(transaction_id)})
        return _serialize(doc) if doc else None

    def update_transaction(self, transaction_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        converted_updates = {
            k: _ensure_object_id(v)
            if k in {"asset_id", "scenario_id", "counter_asset_id", "mortgage_asset_id"}
            else v
            for k, v in updates.items()
        }
        # If amount is provided and entry=credit, ensure amount is negative to keep debit/credit consistency
        current = self.db.transactions.find_one({"_id": _ensure_object_id(transaction_id)})
        if current and "amount" in updates and current.get("entry") == "credit":
            converted_updates["amount"] = -abs(converted_updates.get("amount", updates["amount"]))
        if current and "amount" in updates and current.get("entry") == "debit":
            converted_updates["amount"] = abs(converted_updates.get("amount", updates["amount"]))
        doc = self.db.transactions.find_one_and_update(
            {"_id": _ensure_object_id(transaction_id)},
            {"$set": converted_updates},
            return_document=ReturnDocument.AFTER,
        )
        return _serialize(doc) if doc else None

    def delete_transaction(self, transaction_id: str) -> bool:
        tx = self.db.transactions.find_one({"_id": _ensure_object_id(transaction_id)})
        if not tx:
            return False
        link_id = tx.get("link_id")
        if link_id:
            result = self.db.transactions.delete_many({"link_id": link_id})
            return result.deleted_count > 0
        result = self.db.transactions.delete_one({"_id": _ensure_object_id(transaction_id)})
        return result.deleted_count > 0

    # Stress Profiles ------------------------------------------------------
    def list_stress_profiles(self, user_id: str) -> List[Dict[str, Any]]:
        user_oid = _ensure_object_id(user_id)
        query = {"$or": [{"user_id": user_oid}, {"is_public": True}]}
        profiles = []
        for doc in self.db.stress_profiles.find(query):
            serialized = _serialize(doc)
            serialized.setdefault("is_public", False)
            profiles.append(serialized)
        return profiles

    def create_stress_profile(
        self,
        user_id: str,
        name: str,
        description: str | None,
        overrides: Dict[str, Any],
        is_public: bool = False,
    ) -> Dict[str, Any]:
        doc = {
            "user_id": _ensure_object_id(user_id),
            "name": name,
            "description": description,
            "overrides": overrides,
            "is_public": bool(is_public),
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        res = self.db.stress_profiles.insert_one(doc)
        doc["_id"] = res.inserted_id
        return _serialize(doc)

    def update_stress_profile(self, profile_id: str, user_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        allowed_fields = {"name", "description", "overrides", "is_public"}
        allowed = {k: v for k, v in updates.items() if k in allowed_fields and v is not None}
        if not allowed:
            return None
        allowed["updated_at"] = datetime.utcnow()
        doc = self.db.stress_profiles.find_one_and_update(
            {"_id": _ensure_object_id(profile_id), "user_id": _ensure_object_id(user_id)},
            {"$set": allowed},
            return_document=ReturnDocument.AFTER,
        )
        return _serialize(doc) if doc else None

    def delete_stress_profile(self, profile_id: str, user_id: str) -> bool:
        res = self.db.stress_profiles.delete_one({"_id": _ensure_object_id(profile_id), "user_id": _ensure_object_id(user_id)})
        return res.deleted_count > 0

    # Tax Profiles --------------------------------------------------------
    def list_tax_profiles(self, user_id: str) -> List[Dict[str, Any]]:
        return [
            _serialize(doc)
            for doc in self.db.tax_profiles.find({"user_id": _ensure_object_id(user_id)})
        ]

    def get_tax_profile(self, profile_id: str) -> Optional[Dict[str, Any]]:
        doc = self.db.tax_profiles.find_one({"_id": _ensure_object_id(profile_id)})
        return _serialize(doc) if doc else None

    def create_tax_profile(
        self,
        user_id: str,
        name: str,
        description: str | None,
        location: str | None,
        church: str | None,
        marital_status: str | None,
        income_brackets: List[Dict[str, Any]],
        wealth_brackets: List[Dict[str, Any]],
        federal_table: List[Dict[str, Any]],
        municipal_tax_factor: float | None = None,
        cantonal_tax_factor: float | None = None,
        church_tax_factor: float | None = None,
        personal_tax_per_person: float | None = None,
    ) -> Dict[str, Any]:
        doc = {
            "user_id": _ensure_object_id(user_id),
            "name": name,
            "description": description,
            "location": location,
            "church": church,
            "marital_status": marital_status,
            "income_brackets": income_brackets or [],
            "wealth_brackets": wealth_brackets or [],
            "federal_table": federal_table or [],
            "municipal_tax_factor": municipal_tax_factor,
            "cantonal_tax_factor": cantonal_tax_factor,
            "church_tax_factor": church_tax_factor,
            "personal_tax_per_person": personal_tax_per_person,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        res = self.db.tax_profiles.insert_one(doc)
        doc["_id"] = res.inserted_id
        return _serialize(doc)

    def update_tax_profile(self, profile_id: str, user_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        allowed_keys = {
            "name",
            "description",
            "income_brackets",
            "wealth_brackets",
            "federal_table",
            "municipal_tax_factor",
            "cantonal_tax_factor",
            "church_tax_factor",
            "personal_tax_per_person",
            "location",
            "church",
            "marital_status",
        }
        filtered = {k: v for k, v in updates.items() if v is not None and k in allowed_keys}
        if not filtered:
            return None
        filtered["updated_at"] = datetime.utcnow()
        doc = self.db.tax_profiles.find_one_and_update(
            {"_id": _ensure_object_id(profile_id), "user_id": _ensure_object_id(user_id)},
            {"$set": filtered},
            return_document=ReturnDocument.AFTER,
        )
        return _serialize(doc) if doc else None

    def delete_tax_profile(self, profile_id: str, user_id: str) -> bool:
        res = self.db.tax_profiles.delete_one({"_id": _ensure_object_id(profile_id), "user_id": _ensure_object_id(user_id)})
        return res.deleted_count > 0

    # Municipal Tax Tables ------------------------------------------------
    def list_municipal_tax_rates(self, canton: Optional[str] = None) -> List[Dict[str, Any]]:
        query: Dict[str, Any] = {}
        if canton:
            query["canton"] = canton
        return [
            _serialize(doc)
            for doc in self.db.municipal_tax_rates.find(query).sort("municipality", 1)
        ]

    def list_municipal_cantons(self) -> List[str]:
        cantons = self.db.municipal_tax_rates.distinct("canton")
        return sorted(c for c in cantons if c)

    def get_municipal_tax_rate(self, entry_id: str) -> Optional[Dict[str, Any]]:
        doc = self.db.municipal_tax_rates.find_one({"_id": _ensure_object_id(entry_id)})
        return _serialize(doc) if doc else None

    def create_municipal_tax_rate(
        self,
        municipality: str,
        canton: str,
        base_rate: float,
        ref_rate: Optional[float],
        cath_rate: Optional[float],
        christian_cath_rate: Optional[float],
    ) -> Dict[str, Any]:
        doc = {
            "municipality": municipality,
            "canton": canton,
            "base_rate": _round_two_decimals(base_rate),
            "ref_rate": _round_two_decimals(ref_rate),
            "cath_rate": _round_two_decimals(cath_rate),
            "christian_cath_rate": _round_two_decimals(christian_cath_rate),
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        res = self.db.municipal_tax_rates.insert_one(doc)
        doc["_id"] = res.inserted_id
        return _serialize(doc)

    def update_municipal_tax_rate(self, entry_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        allowed_keys = {"municipality", "canton", "base_rate", "ref_rate", "cath_rate", "christian_cath_rate"}
        filtered: Dict[str, Any] = {}
        for key, value in updates.items():
            if key not in allowed_keys or value is None:
                continue
            if key in {"base_rate", "ref_rate", "cath_rate", "christian_cath_rate"}:
                filtered[key] = _round_two_decimals(value)
            else:
                filtered[key] = value
        if not filtered:
            return None
        filtered["updated_at"] = datetime.utcnow()
        doc = self.db.municipal_tax_rates.find_one_and_update(
            {"_id": _ensure_object_id(entry_id)},
            {"$set": filtered},
            return_document=ReturnDocument.AFTER,
        )
        return _serialize(doc) if doc else None

    def delete_municipal_tax_rate(self, entry_id: str) -> bool:
        res = self.db.municipal_tax_rates.delete_one({"_id": _ensure_object_id(entry_id)})
        return res.deleted_count > 0

    # State Tax Tariffs ---------------------------------------------------
    def list_state_tax_tariffs(self, scope: Optional[str] = None, canton: Optional[str] = None) -> List[Dict[str, Any]]:
        query: Dict[str, Any] = {}
        if scope:
            query["scope"] = scope
        if canton:
            query["canton"] = canton
        return [
            _serialize(doc)
            for doc in self.db.state_tax_tariffs.find(query).sort("name", 1)
        ]

    def get_state_tax_tariff(self, tariff_id: str) -> Optional[Dict[str, Any]]:
        doc = self.db.state_tax_tariffs.find_one({"_id": _ensure_object_id(tariff_id)})
        return _serialize(doc) if doc else None

    def create_state_tax_tariff(
        self,
        name: str,
        scope: str,
        rows: List[Dict[str, Any]],
        description: Optional[str] = None,
        canton: Optional[str] = None,
    ) -> Dict[str, Any]:
        doc = {
            "name": name,
            "scope": scope,
            "description": description,
            "canton": canton,
            "rows": _normalize_tariff_rows(rows),
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        res = self.db.state_tax_tariffs.insert_one(doc)
        doc["_id"] = res.inserted_id
        return _serialize(doc)

    def update_state_tax_tariff(self, tariff_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        allowed_fields = {"name", "scope", "description", "canton", "rows"}
        filtered: Dict[str, Any] = {}
        for key, value in updates.items():
            if key not in allowed_fields or value is None:
                continue
            if key == "rows":
                filtered[key] = _normalize_tariff_rows(value)
            else:
                filtered[key] = value
        if not filtered:
            return None
        filtered["updated_at"] = datetime.utcnow()
        doc = self.db.state_tax_tariffs.find_one_and_update(
            {"_id": _ensure_object_id(tariff_id)},
            {"$set": filtered},
            return_document=ReturnDocument.AFTER,
        )
        return _serialize(doc) if doc else None

    def delete_state_tax_tariff(self, tariff_id: str) -> bool:
        res = self.db.state_tax_tariffs.delete_one({"_id": _ensure_object_id(tariff_id)})
        return res.deleted_count > 0

    # Federal Tax Tables --------------------------------------------------
    def list_federal_tax_tables(self) -> List[Dict[str, Any]]:
        return [
            _serialize(doc)
            for doc in self.db.federal_tax_tables.find().sort("name", 1)
        ]

    def get_federal_tax_table(self, table_id: str) -> Optional[Dict[str, Any]]:
        doc = self.db.federal_tax_tables.find_one({"_id": _ensure_object_id(table_id)})
        return _serialize(doc) if doc else None

    def create_federal_tax_table(
        self,
        name: str,
        rows: List[Dict[str, Any]],
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        doc = {
            "name": name,
            "description": description,
            "rows": _normalize_tariff_rows(rows),
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        res = self.db.federal_tax_tables.insert_one(doc)
        doc["_id"] = res.inserted_id
        return _serialize(doc)

    def update_federal_tax_table(self, table_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        allowed_fields = {"name", "description", "rows"}
        filtered: Dict[str, Any] = {}
        for key, value in updates.items():
            if key not in allowed_fields or value is None:
                continue
            if key == "rows":
                filtered[key] = _normalize_tariff_rows(value)
            else:
                filtered[key] = value
        if not filtered:
            return None
        filtered["updated_at"] = datetime.utcnow()
        doc = self.db.federal_tax_tables.find_one_and_update(
            {"_id": _ensure_object_id(table_id)},
            {"$set": filtered},
            return_document=ReturnDocument.AFTER,
        )
        return _serialize(doc) if doc else None

    def delete_federal_tax_table(self, table_id: str) -> bool:
        res = self.db.federal_tax_tables.delete_one({"_id": _ensure_object_id(table_id)})
        return res.deleted_count > 0

    # Personal Tax per Canton --------------------------------------------
    def list_personal_taxes(self) -> List[Dict[str, Any]]:
        return [
            _serialize(doc)
            for doc in self.db.personal_taxes.find().sort("canton", 1)
        ]

    def get_personal_tax_for_canton(self, canton: str) -> Optional[Dict[str, Any]]:
        doc = self.db.personal_taxes.find_one({"canton": canton})
        return _serialize(doc) if doc else None

    def create_personal_tax(self, canton: str, amount: float) -> Dict[str, Any]:
        doc = {
            "canton": canton,
            "amount": _round_two_decimals(amount),
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        res = self.db.personal_taxes.insert_one(doc)
        doc["_id"] = res.inserted_id
        return _serialize(doc)

    def update_personal_tax(self, entry_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        allowed = {}
        for field in ("canton", "amount"):
            if field in updates and updates[field] is not None:
                allowed[field] = _round_two_decimals(updates[field]) if field == "amount" else updates[field]
        if not allowed:
            return None
        allowed["updated_at"] = datetime.utcnow()
        doc = self.db.personal_taxes.find_one_and_update(
            {"_id": _ensure_object_id(entry_id)},
            {"$set": allowed},
            return_document=ReturnDocument.AFTER,
        )
        return _serialize(doc) if doc else None

    def delete_personal_tax(self, entry_id: str) -> bool:
        res = self.db.personal_taxes.delete_one({"_id": _ensure_object_id(entry_id)})
        return res.deleted_count > 0
