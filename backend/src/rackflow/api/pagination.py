"""Opaque keyset cursors: base64("<iso timestamp>|<uuid>")."""

from __future__ import annotations

import base64
import binascii
import uuid
from datetime import datetime

from rackflow.core.errors import ValidationFailedError


def encode_cursor(ts: datetime, item_id: uuid.UUID) -> str:
    return base64.urlsafe_b64encode(f"{ts.isoformat()}|{item_id}".encode()).decode()


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        ts, _, item_id = raw.partition("|")
        return datetime.fromisoformat(ts), uuid.UUID(item_id)
    except (ValueError, binascii.Error, UnicodeDecodeError) as exc:
        raise ValidationFailedError(code="INVALID_CURSOR", message="Invalid cursor.") from exc
