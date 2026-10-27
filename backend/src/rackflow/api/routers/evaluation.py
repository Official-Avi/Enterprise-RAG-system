"""Evaluation runs endpoints."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/evaluation", tags=["evaluation"])
