from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import os
import re
import json
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from bson import ObjectId
from pymongo import ReturnDocument
from cryptography.fernet import Fernet, InvalidToken

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


def _normalize_email(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    return value.strip().lower() or None


def _normalize_phone(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    sanitized = re.sub(r"[^\d+]", "", raw)
    if sanitized.startswith("00"):
        sanitized = f"+{sanitized[2:]}"
    if not sanitized.startswith("+"):
        sanitized = f"+{sanitized.lstrip('+')}"
    digits = "+" + re.sub(r"\D", "", sanitized)
    if len(digits) < 8 or len(digits) > 16:
        return None
    return digits


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
        doc.pop("username_token", None)
        doc.pop("username", None)
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


PROFILE_ENCRYPTION_VERSION = "v1"


class WealthRepository:
    """Data access layer for users, assets, transactions, and scenarios."""

    def __init__(self, db=None):
        self.db = db or get_database()
        self._username_secret = os.getenv("USERNAME_HASH_SECRET") or None
        self._pii_cipher = self._init_pii_cipher()
        token_secret = os.getenv("PII_HASH_SECRET") or self._username_secret
        self._pii_hash_secret = token_secret or "please_set_PII_HASH_SECRET"

    def _tokenize_username(self, username: str) -> str:
        secret = self._username_secret
        if not secret:
            # Fallback secret to avoid crashes; set via env for stronger secrecy.
            secret = "please_set_USERNAME_HASH_SECRET"
        msg = username.strip().lower().encode("utf-8")
        return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()

    def _init_pii_cipher(self) -> Fernet:
        key = os.getenv("PII_ENCRYPTION_KEY")
        candidates = []
        if key:
            candidates.append(key.encode("utf-8"))
            # Also allow using arbitrary passphrases by deriving a Fernet key.
            candidates.append(base64.urlsafe_b64encode(hashlib.sha256(key.encode("utf-8")).digest()))
        else:
            candidates.append(base64.urlsafe_b64encode(hashlib.sha256(b"default-pii-key").digest()))
        last_error: Optional[Exception] = None
        for candidate in candidates:
            try:
                return Fernet(candidate)
            except Exception as exc:  # pragma: no cover - defensive fallback
                last_error = exc
                continue
        raise RuntimeError(f"Unable to initialize PII cipher: {last_error}")  # pragma: no cover

    def _tokenize_contact_value(self, value: Optional[str], purpose: str) -> Optional[str]:
        if not value:
            return None
        secret = self._pii_hash_secret
        if not secret:
            return None
        payload = f"{purpose}:{value}".encode("utf-8")
        return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()

    def _contact_lookup_filter(
        self, normalized_value: Optional[str], token_field: str, legacy_field: str, purpose: str
    ) -> Optional[Dict[str, Any]]:
        if not normalized_value:
            return None
        clauses = [{legacy_field: normalized_value}]
        token = self._tokenize_contact_value(normalized_value, purpose)
        if token:
            clauses.append({token_field: token})
        return {"$or": clauses}

    def _encrypt_profile_blob(self, profile: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        cipher = self._pii_cipher
        if not cipher:
            return None
        cleaned = {k: v for k, v in profile.items() if v is not None}
        if not cleaned:
            return None
        payload = json.dumps(cleaned, separators=(",", ":"), sort_keys=True).encode("utf-8")
        ciphertext = cipher.encrypt(payload).decode("utf-8")
        return {"version": PROFILE_ENCRYPTION_VERSION, "alg": "fernet", "ciphertext": ciphertext}

    def _decrypt_profile_blob(self, blob: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        if not blob or not isinstance(blob, dict):
            return {}
        cipher = self._pii_cipher
        token = blob.get("ciphertext") or blob.get("token")
        if not cipher or not token:
            return {}
        try:
            decrypted = cipher.decrypt(token.encode("utf-8"))
        except (InvalidToken, ValueError, TypeError):  # pragma: no cover - corruption/legacy data
            return {}
        try:
            data = json.loads(decrypted.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):  # pragma: no cover - corruption
            return {}
        return data if isinstance(data, dict) else {}

    def _upsert_profile_blob_if_missing(self, document: Dict[str, Any]) -> None:
        """Encrypt legacy plaintext fields lazily to cover pre-migration records."""
        if not document or document.get("profile_encrypted"):
            return
        legacy_name = document.get("name")
        legacy_email = _normalize_email(document.get("email"))
        legacy_phone = _normalize_phone(document.get("phone"))
        profile_blob = self._encrypt_profile_blob(
            {"name": legacy_name, "email": legacy_email, "phone": legacy_phone}
        )
        if not profile_blob:
            return
        updates: Dict[str, Any] = {"profile_encrypted": profile_blob}
        tokens: Dict[str, str] = {}
        if legacy_email:
            token = self._tokenize_contact_value(legacy_email, "email")
            if token:
                tokens["email_token"] = token
        if legacy_phone:
            token = self._tokenize_contact_value(legacy_phone, "phone")
            if token:
                tokens["phone_token"] = token
        unset_payload = {k: "" for k in ("name", "email", "phone") if document.get(k) is not None}
        updates.update(tokens)
        document.update(updates)
        for field in ("name", "email", "phone"):
            if field in document:
                document.pop(field, None)
        ops: Dict[str, Any] = {"$set": updates}
        if unset_payload:
            ops["$unset"] = unset_payload
        self.db.users.update_one({"_id": document["_id"]}, ops)

    def _public_user(self, document: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not document:
            return None
        self._upsert_profile_blob_if_missing(document)
        doc = _serialize_user(document)
        if not doc:
            return doc
        encrypted_profile = doc.pop("profile_encrypted", None)
        doc.pop("email_token", None)
        doc.pop("phone_token", None)
        profile_fields = self._decrypt_profile_blob(encrypted_profile)
        for key, value in profile_fields.items():
            if value is not None:
                doc[key] = value
        return doc

    # Users -----------------------------------------------------------------
    def create_user(
        self,
        username: str,
        password: str,
        name: str | None,
        email: Optional[str] = None,
        phone: Optional[str] = None,
    ) -> Dict[str, Any]:
        username_token = self._tokenize_username(username)
        if self.db.users.find_one({"username_token": username_token}):
            raise ValueError("Username already exists")
        normalized_email = _normalize_email(email)
        email_filter = self._contact_lookup_filter(normalized_email, "email_token", "email", "email")
        if email_filter and self.db.users.find_one(email_filter):
            raise ValueError("Email already in use")
        normalized_phone = _normalize_phone(phone)
        if not normalized_phone:
            raise ValueError("Phone number is required")
        phone_filter = self._contact_lookup_filter(normalized_phone, "phone_token", "phone", "phone")
        if phone_filter and self.db.users.find_one(phone_filter):
            raise ValueError("Phone number already in use")
        profile_blob = self._encrypt_profile_blob(
            {"name": name, "email": normalized_email, "phone": normalized_phone}
        )
        if not profile_blob:
            raise ValueError("Failed to encrypt profile data")
        doc: Dict[str, Any] = {
            "username_token": username_token,
            "password_hash": _hash_password(password),
            "profile_encrypted": profile_blob,
            "created_at": datetime.utcnow(),
        }
        email_token = self._tokenize_contact_value(normalized_email, "email")
        if email_token:
            doc["email_token"] = email_token
        phone_token = self._tokenize_contact_value(normalized_phone, "phone")
        if phone_token:
            doc["phone_token"] = phone_token
        result = self.db.users.insert_one(doc)
        doc["_id"] = result.inserted_id
        return self._public_user(doc)

    def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        doc = self.db.users.find_one({"_id": _ensure_object_id(user_id)})
        return self._public_user(doc)

    def get_user_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        normalized = _normalize_email(email)
        query = self._contact_lookup_filter(normalized, "email_token", "email", "email")
        if not normalized or not query:
            return None
        doc = self.db.users.find_one(query)
        return self._public_user(doc)

    def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        token = self._tokenize_username(username)
        doc = self.db.users.find_one({"username_token": token})
        if not doc:
            # Legacy fallback: migrate plain username to tokenized
            doc = self.db.users.find_one({"username": username})
            if doc:
                self.db.users.update_one(
                    {"_id": doc["_id"]}, {"$set": {"username_token": token}, "$unset": {"username": ""}}
                )
                doc["username_token"] = token
                doc.pop("username", None)
        return self._public_user(doc)

    def get_user_with_secret_fields(self, username: str) -> Optional[Dict[str, Any]]:
        """Internal helper to retrieve user with password/token hashes."""
        token = self._tokenize_username(username)
        doc = self.db.users.find_one({"username_token": token})
        if not doc:
            # Legacy fallback: migrate and clear plaintext username
            doc = self.db.users.find_one({"username": username})
            if doc:
                self.db.users.update_one(
                    {"_id": doc["_id"]}, {"$set": {"username_token": token}, "$unset": {"username": ""}}
                )
                doc["username_token"] = token
                doc.pop("username", None)
        return _serialize(doc) if doc else None

    def list_users(self) -> List[Dict[str, Any]]:
        # Expose only sanitized data; callers should additionally scope to current user.
        users: List[Dict[str, Any]] = []
        for doc in self.db.users.find():
            public = self._public_user(doc)
            if public:
                users.append(public)
        return users

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
        return self._public_user(doc)

    def change_password(self, user_id: str, current_password: str, new_password: str) -> Optional[Dict[str, Any]]:
        if not current_password or not new_password:
            return None
        user = self.db.users.find_one({"_id": _ensure_object_id(user_id)})
        if not user:
            return None
        password_hash = user.get("password_hash")
        if not password_hash or not _verify_password(current_password, password_hash):
            return None
        updated = self.db.users.find_one_and_update(
            {"_id": user["_id"]},
            {"$set": {"password_hash": _hash_password(new_password)}},
            return_document=ReturnDocument.AFTER,
        )
        return self._public_user(updated) if updated else None

    def delete_user(self, user_id: str) -> bool:
        user_oid = _ensure_object_id(user_id)
        scenarios = list(self.db.scenarios.find({"user_id": user_oid}, {"_id": 1}))
        for scenario in scenarios:
            self.delete_scenario(str(scenario["_id"]))
        result = self.db.users.delete_one({"_id": user_oid})
        return result.deleted_count > 0

    def _issue_timed_token(self, field_prefix: str, user_filter: Dict[str, Any], ttl_hours: int = 2) -> Optional[str]:
        token = f"{secrets.randbelow(999999):06d}"
        token_hash = _hash_token(token)
        expires_at = datetime.utcnow() + timedelta(hours=ttl_hours)
        updated = self.db.users.find_one_and_update(
            user_filter,
            {"$set": {f"{field_prefix}_token_hash": token_hash, f"{field_prefix}_expires_at": expires_at}},
            return_document=ReturnDocument.AFTER,
        )
        if not updated:
            return None
        return token

    def create_password_reset_request(self, phone: str) -> Optional[str]:
        normalized = _normalize_phone(phone)
        if not normalized:
            return None
        query = self._contact_lookup_filter(normalized, "phone_token", "phone", "phone")
        if not query:
            return None
        user = self.db.users.find_one(query)
        if not user:
            return None
        return self._issue_timed_token("password_reset", {"_id": user["_id"]}, ttl_hours=1)

    def reset_password_with_token(self, token: str, new_password: str) -> Optional[Dict[str, Any]]:
        if not token or not new_password:
            return None
        token_hash = _hash_token(token)
        now = datetime.utcnow()
        user = self.db.users.find_one(
            {
                "password_reset_token_hash": token_hash,
                "password_reset_expires_at": {"$gte": now},
            }
        )
        if not user:
            return None
        updated = self.db.users.find_one_and_update(
            {"_id": user["_id"]},
            {
                "$set": {"password_hash": _hash_password(new_password)},
                "$unset": {"password_reset_token_hash": "", "password_reset_expires_at": ""},
            },
            return_document=ReturnDocument.AFTER,
        )
        return self._public_user(updated) if updated else None

    # Vault (client-side encryption helpers) -------------------------------
    def get_vault(self, user_id: str) -> Tuple[Optional[Dict[str, Any]], Optional[datetime]]:
        """Return vault metadata (wrapped keys only) for a user."""
        doc = self.db.users.find_one(
            {"_id": _ensure_object_id(user_id)}, {"vault": 1, "vault_updated_at": 1}
        )
        if not doc:
            return None, None
        return doc.get("vault"), doc.get("vault_updated_at")

    def upsert_vault(self, user_id: str, vault_data: Dict[str, Any]) -> Tuple[Dict[str, Any], datetime]:
        """Store vault metadata (no plaintext) for a user."""
        now = datetime.utcnow()
        updated = self.db.users.find_one_and_update(
            {"_id": _ensure_object_id(user_id)},
            {"$set": {"vault": vault_data, "vault_updated_at": now}},
            return_document=ReturnDocument.AFTER,
        )
        if not updated:
            raise ValueError("User not found")
        return vault_data, now

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
        tax_confession_partner: str | None = None,
        tax_marital_status: str | None = None,
        num_children: int | None = None,
        encrypted: Dict[str, Any] | None = None,
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
            "tax_confession_partner": tax_confession_partner,
            "tax_marital_status": tax_marital_status,
            "num_children": num_children,
            "encrypted": encrypted,
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
        encrypted: Dict[str, Any] | None = None,
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
            "encrypted": encrypted,
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
        encrypted: Dict[str, Any] | None = None,
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
            "encrypted": encrypted,
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
        encrypted: Dict[str, Any] | None = None,
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
            "encrypted": encrypted,
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

    # State Tax Rates ----------------------------------------------------
    def list_state_tax_rates(self) -> List[Dict[str, Any]]:
        return [
            _serialize(doc)
            for doc in self.db.state_tax_rates.find().sort("canton", 1)
        ]

    def list_state_tax_cantons(self) -> List[str]:
        cantons = self.db.state_tax_rates.distinct("canton")
        return sorted(c for c in cantons if c)

    def list_tax_cantons(self) -> List[str]:
        """Return union of cantons that have municipal or state tax data."""
        municipal = set(self.list_municipal_cantons())
        state = set(self.list_state_tax_cantons())
        return sorted(municipal | state)

    def get_state_tax_rate_for_canton(self, canton: str) -> Optional[Dict[str, Any]]:
        doc = self.db.state_tax_rates.find_one({"canton": canton})
        return _serialize(doc) if doc else None

    def create_state_tax_rate(self, canton: str, rate: float) -> Dict[str, Any]:
        doc = {
            "canton": canton,
            "rate": _round_two_decimals(rate),
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        res = self.db.state_tax_rates.insert_one(doc)
        doc["_id"] = res.inserted_id
        return _serialize(doc)

    def update_state_tax_rate(self, entry_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        allowed = {}
        for field in ("canton", "rate"):
            if field in updates and updates[field] is not None:
                allowed[field] = _round_two_decimals(updates[field]) if field == "rate" else updates[field]
        if not allowed:
            return None
        allowed["updated_at"] = datetime.utcnow()
        doc = self.db.state_tax_rates.find_one_and_update(
            {"_id": _ensure_object_id(entry_id)},
            {"$set": allowed},
            return_document=ReturnDocument.AFTER,
        )
        return _serialize(doc) if doc else None

    def delete_state_tax_rate(self, entry_id: str) -> bool:
        res = self.db.state_tax_rates.delete_one({"_id": _ensure_object_id(entry_id)})
        return res.deleted_count > 0

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

    def import_municipal_tax_rates(self, rows: List[Dict[str, Any]]) -> int:
        docs = []
        for row in rows or []:
            municipality = row.get("municipality")
            canton = row.get("canton") or row.get("canton_code") or ""
            if not municipality or not canton:
                continue
            doc = {
                "municipality": municipality,
                "canton": canton,
                "base_rate": _round_two_decimals(row.get("base_rate")),
                "ref_rate": _round_two_decimals(row.get("ref_rate")),
                "cath_rate": _round_two_decimals(row.get("cath_rate")),
                "christian_cath_rate": _round_two_decimals(row.get("christian_cath_rate")),
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
            }
            docs.append(doc)
        if not docs:
            return 0
        # Replace the entire table
        self.db.municipal_tax_rates.delete_many({})
        res = self.db.municipal_tax_rates.insert_many(docs)
        return len(res.inserted_ids)

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
        child_deduction_per_child: Optional[float] = None,
    ) -> Dict[str, Any]:
        doc = {
            "name": name,
            "description": description,
            "rows": _normalize_tariff_rows(rows),
            "child_deduction_per_child": _round_two_decimals(child_deduction_per_child),
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        res = self.db.federal_tax_tables.insert_one(doc)
        doc["_id"] = res.inserted_id
        return _serialize(doc)

    def update_federal_tax_table(self, table_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        allowed_fields = {"name", "description", "rows", "child_deduction_per_child"}
        filtered: Dict[str, Any] = {}
        for key, value in updates.items():
            if key not in allowed_fields or value is None:
                continue
            if key == "rows":
                filtered[key] = _normalize_tariff_rows(value)
            elif key == "child_deduction_per_child":
                filtered[key] = _round_two_decimals(value)
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
