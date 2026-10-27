"""Document upload, listing, pipeline status, retry and deletion endpoints."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/documents", tags=["documents"])
