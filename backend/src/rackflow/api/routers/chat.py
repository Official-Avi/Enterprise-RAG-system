"""RAG chat sessions and grounded answers endpoints."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/chat", tags=["chat"])
