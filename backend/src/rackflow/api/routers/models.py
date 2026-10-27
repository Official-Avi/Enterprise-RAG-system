"""Model serving status, health and metrics endpoints."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/models", tags=["models"])
