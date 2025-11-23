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
        converted_updates = {k: _ensure_object_id(v) if k in {"user_id"} else v for k, v in updates.items()}
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
