"""Logical racks, nodes and workloads endpoints."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/infrastructure", tags=["infrastructure"])
