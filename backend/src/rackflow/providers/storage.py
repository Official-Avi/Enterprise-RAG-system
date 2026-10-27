"""Object storage adapters. Keys are always generated server-side (never from filenames)."""

from __future__ import annotations

import os
import re
import tempfile
import uuid
from functools import lru_cache
from pathlib import Path

from rackflow.core.config import get_settings

_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9/_\-.]{0,500}$")


def document_key(tenant_id: uuid.UUID, document_id: uuid.UUID) -> str:
    return f"tenants/{tenant_id}/documents/{document_id}/original"


class LocalObjectStorage:
    """Filesystem storage for development and single-node deployments."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        if not _KEY_RE.match(key) or ".." in key.split("/"):
            raise ValueError("invalid storage key")
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("invalid storage key")
        return path

    def put(self, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".upload-")
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()


@lru_cache(maxsize=1)
def get_object_storage() -> LocalObjectStorage:
    return LocalObjectStorage(get_settings().object_storage_path)
