"""Job queue listing, detail, retry and cancel endpoints."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/jobs", tags=["jobs"])
