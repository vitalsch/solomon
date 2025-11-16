import os
from functools import lru_cache

from pymongo import MongoClient


def _build_client() -> MongoClient:
    mongo_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
    return MongoClient(mongo_uri, tz_aware=True)


@lru_cache(maxsize=1)
def get_client() -> MongoClient:
    """Return cached Mongo client so FastAPI reuses connections."""
    return _build_client()


def get_database():
    db_name = os.getenv("MONGODB_DB", "wealth_planner")
    return get_client()[db_name]
