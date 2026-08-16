"""API request and response shapes.

Separate from `models.py` on purpose: the ORM row and the wire representation
are allowed to diverge, and a user record in particular must never serialise
its `hashed_password`. Inheriting from the fastapi-users base schemas is what
guarantees that rather than leaving it to reviewer vigilance.
"""
from __future__ import annotations

import uuid

from fastapi_users import schemas


class UserRead(schemas.BaseUser[uuid.UUID]):
    display_name: str | None = None
    avatar_url: str | None = None


class UserCreate(schemas.BaseUserCreate):
    display_name: str | None = None


class UserUpdate(schemas.BaseUserUpdate):
    display_name: str | None = None
    avatar_url: str | None = None
