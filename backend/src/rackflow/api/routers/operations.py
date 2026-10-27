"""Operations summary, workers and metrics endpoints."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/operations", tags=["operations"])
