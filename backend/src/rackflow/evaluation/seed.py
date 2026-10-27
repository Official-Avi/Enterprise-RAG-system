"""Creates the evaluation collections for a dataset version and uploads the corpus through the
normal ingestion path (validation, dedup, queued jobs). Idempotent."""

from __future__ import annotations

import io
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from rackflow.db.models import Collection, CollectionVisibility
from rackflow.evaluation.dataset import Dataset
from rackflow.ingestion.service import accept_upload, used_storage_bytes
from rackflow.tenant_settings import effective_settings


@dataclass(slots=True)
class SeedResult:
    main_collection_id: uuid.UUID
    restricted_collection_id: uuid.UUID
    queued: int
    duplicates: int
    rejected: list[str]


def _scanned_pdf(lines: list[str]) -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGB", (1240, 1754), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=44)
    for i, line in enumerate(lines):
        draw.text((100, 120 + 80 * i), line, fill="black", font=font)
    buf = io.BytesIO()
    image.save(buf, format="PDF", resolution=150)
    return buf.getvalue()


def _collection(db: Session, tenant_id: uuid.UUID, name: str, visibility: CollectionVisibility,
                created_by: uuid.UUID | None, description: str) -> Collection:
    c = db.scalar(select(Collection).where(Collection.tenant_id == tenant_id,
                                           Collection.name == name))
    if c is None:
        c = Collection(tenant_id=tenant_id, name=name, visibility=visibility,
                       created_by=created_by, description=description)
        db.add(c)
        db.commit()
    return c


def seed_dataset(db: Session, dataset: Dataset, *, tenant_id: uuid.UUID,
                 user_id: uuid.UUID) -> SeedResult:
    main = _collection(db, tenant_id, f"Evaluation corpus ({dataset.version})",
                       CollectionVisibility.TENANT, user_id,
                       "Synthetic documents used by the evaluation runner.")
    # created_by=None: only org admins and explicit grants can read the restricted corpus.
    restricted = _collection(db, tenant_id, f"Evaluation restricted ({dataset.version})",
                             CollectionVisibility.RESTRICTED, None,
                             "Restricted evaluation document (permission-leak test).")
    settings = effective_settings(db, tenant_id)
    used = used_storage_bytes(db, tenant_id)
    files: list[tuple[uuid.UUID, str, bytes]] = []
    for doc in dataset.documents:
        target = restricted.id if doc.get("collection") == "restricted" else main.id
        files.append((target, doc["filename"], dataset.corpus_path(doc["filename"]).read_bytes()))
    for scan in dataset.scanned_documents:
        raw_lines = scan.get("lines", [])
        lines = [str(x) for x in raw_lines] if isinstance(raw_lines, list) else []
        files.append((main.id, str(scan["filename"]), _scanned_pdf(lines)))

    queued = duplicates = 0
    rejected: list[str] = []
    for collection_id, filename, data in files:
        result = accept_upload(db, tenant_id=tenant_id, collection_id=collection_id,
                               user_id=user_id, filename=filename, data=data, settings=settings,
                               used_bytes=used)
        used += result.stored_bytes
        if result.status == "queued":
            queued += 1
        elif result.status == "duplicate":
            duplicates += 1
        else:
            rejected.append(f"{filename}: {result.error_code}")
    return SeedResult(main_collection_id=main.id, restricted_collection_id=restricted.id,
                      queued=queued, duplicates=duplicates, rejected=rejected)
