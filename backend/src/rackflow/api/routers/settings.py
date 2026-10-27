"""Tenant and model settings endpoints."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/settings", tags=["settings"])
