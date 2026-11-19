"""allow the conversational evidence status (greetings, thanks, help)

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-19
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONSTRAINT = "ck_chat_messages_evidence_status"


def upgrade() -> None:
    op.drop_constraint(op.f(CONSTRAINT), "chat_messages", type_="check")
    op.create_check_constraint(
        "evidence_status", "chat_messages",
        "evidence_status IN ('supported', 'insufficient', 'conversational')")


def downgrade() -> None:
    op.execute("UPDATE chat_messages SET evidence_status = 'insufficient' "
               "WHERE evidence_status = 'conversational'")
    op.drop_constraint(op.f(CONSTRAINT), "chat_messages", type_="check")
    op.create_check_constraint(
        "evidence_status", "chat_messages", "evidence_status IN ('supported', 'insufficient')")
