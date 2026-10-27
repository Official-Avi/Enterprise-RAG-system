"""INGEST_DOCUMENT job handler (ARCHITECTURE §4.1). Every stage is recorded via `ctx.stage` and
is idempotent: a redelivered job rebuilds the same version's chunks with the same IDs."""

from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from rackflow import PIPELINE_VERSION
from rackflow.db.models import (
    Chunk,
    Document,
    DocumentStatus,
    DocumentVersion,
    PipelineStage,
)
from rackflow.ingestion.chunking import chunk_pages
from rackflow.ingestion.cleaning import clean_pages
from rackflow.ingestion.quality import assess_quality
from rackflow.jobs.context import JobContext
from rackflow.jobs.errors import PermanentJobError, RetryableJobError
from rackflow.providers.extractors import get_extractor
from rackflow.providers.interfaces import ExtractedPage
from rackflow.providers.ocr import get_ocr_provider, render_pdf_page_png
from rackflow.providers.storage import get_object_storage
from rackflow.providers.tokenizer import get_tokenizer
from rackflow.rag.injection import looks_like_injection
from rackflow.tenant_settings import effective_settings

log = logging.getLogger(__name__)

MAX_OCR_PAGES = 50
LOW_OCR_CONFIDENCE = 0.6
_GONE = (DocumentStatus.DELETING, DocumentStatus.DELETED)


def _load_document(ctx: JobContext, document_id: uuid.UUID) -> Document:
    doc = ctx.db.get(Document, document_id, populate_existing=True)
    if doc is None or doc.tenant_id != ctx.tenant_id or doc.status in _GONE:
        raise PermanentJobError("DOCUMENT_GONE", "The document was deleted.")
    return doc


def _get_or_create_version(ctx: JobContext, doc: Document, version: int) -> DocumentVersion:
    db = ctx.db
    row = db.scalar(select(DocumentVersion).where(
        DocumentVersion.document_id == doc.id, DocumentVersion.version == version))
    if row is None:
        row = DocumentVersion(tenant_id=doc.tenant_id, document_id=doc.id, version=version,
                              content_hash=doc.content_hash, pipeline_version=PIPELINE_VERSION)
        db.add(row)
        try:
            db.commit()
        except IntegrityError:  # concurrent redelivery created it first
            db.rollback()
            row = db.scalars(select(DocumentVersion).where(
                DocumentVersion.document_id == doc.id, DocumentVersion.version == version)).one()
    return row


def _run_ocr(ctx: JobContext, data: bytes, pages: list[ExtractedPage], enabled: bool,
             warnings: list[str]) -> dict[str, object]:
    blank = [p for p in pages if not p.text.strip()]
    if not blank:
        return {"skipped": True}
    if not enabled:
        warnings.append(f"{len(blank)} page(s) have no text layer and OCR is disabled")
        return {"skipped": True}
    provider = get_ocr_provider()
    if provider is None:
        warnings.append(f"{len(blank)} page(s) have no text layer and OCR is unavailable")
        return {"skipped": True}
    if len(blank) > MAX_OCR_PAGES:
        warnings.append(f"OCR limited to {MAX_OCR_PAGES} of {len(blank)} image-only pages")
    confidences: list[float] = []
    for page in blank[:MAX_OCR_PAGES]:
        ctx.check_cancelled()
        ctx.heartbeat()
        try:
            text, conf = provider.ocr_image(render_pdf_page_png(data, page.page_number))
        except Exception:  # noqa: BLE001 — a failed page is a warning, not a job failure
            warnings.append(f"OCR failed on page {page.page_number}")
            continue
        if text.strip():
            page.text, page.method, page.ocr_confidence = text, "ocr", conf
            confidences.append(conf)
    avg = sum(confidences) / len(confidences) if confidences else None
    if avg is not None and avg < LOW_OCR_CONFIDENCE:
        warnings.append("OCR confidence is low; scanned text may contain recognition errors")
    return {"ocr_pages": len(confidences), "avg_confidence": round(avg, 3) if avg else None}


def process_document(ctx: JobContext) -> None:
    from rackflow.rag.indexing import delete_document_vectors, index_document_version

    db = ctx.db
    document_id = uuid.UUID(str(ctx.payload["document_id"]))
    version = int(ctx.payload.get("version", 1))
    doc = _load_document(ctx, document_id)
    settings = effective_settings(db, ctx.tenant_id)
    doc.status = DocumentStatus.PROCESSING
    db.commit()
    version_row = _get_or_create_version(ctx, doc, version)
    warnings: list[str] = []

    with ctx.stage(PipelineStage.VALIDATE) as rec:
        try:
            data = get_object_storage().get(doc.storage_key)
        except FileNotFoundError as exc:
            raise PermanentJobError("FILE_MISSING", "The stored file is missing.") from exc
        except OSError as exc:
            raise RetryableJobError("STORAGE_UNAVAILABLE", "File storage is unavailable.") from exc
        if hashlib.sha256(data).hexdigest() != doc.content_hash:
            raise PermanentJobError("INTEGRITY_CHECK_FAILED",
                                    "The stored file failed its integrity check.")
        rec.details = {"size_bytes": len(data)}

    with ctx.stage(PipelineStage.EXTRACT) as rec:
        result = get_extractor(doc.file_type).extract(data, max_pages=settings.upload_max_pages)
        warnings.extend(result.warnings)
        rec.details = {"pages": result.page_count,
                       "pages_with_text": sum(1 for p in result.pages if p.text.strip())}

    with ctx.stage(PipelineStage.OCR) as rec:
        if doc.file_type == "pdf":
            rec.details = _run_ocr(ctx, data, result.pages, settings.ocr_enabled, warnings)
            rec.skipped = bool(rec.details.pop("skipped", False))
        else:
            rec.skipped = True

    pages = [(p.page_number, p.text) for p in result.pages]
    with ctx.stage(PipelineStage.QUALITY_CHECK) as rec:
        report = assess_quality(pages)
        rec.details = {"score": report.score, "empty_pages": report.empty_pages,
                       "chars": report.total_chars}
        if not report.usable:
            raise PermanentJobError("NO_EXTRACTABLE_TEXT",
                                    "No usable text could be extracted from this document.")
        warnings.extend(report.warnings)
        flagged = [n for n, t in pages if looks_like_injection(t)]
        if flagged:
            warnings.append("Contains text resembling instructions to AI systems (page "
                            + ", ".join(map(str, flagged[:5])) + "); it is treated as data only")
            rec.details["instruction_like_pages"] = len(flagged)

    with ctx.stage(PipelineStage.CLEAN) as rec:
        cleaned = clean_pages(pages)
        rec.details = {"chars_before": sum(len(t) for _, t in pages),
                       "chars_after": sum(len(t) for _, t in cleaned)}

    with ctx.stage(PipelineStage.CHUNK) as rec:
        chunks = chunk_pages(cleaned, get_tokenizer(), chunk_size=settings.chunk_size_tokens,
                             overlap=settings.chunk_overlap_tokens)
        if not chunks:
            raise PermanentJobError("NO_EXTRACTABLE_TEXT",
                                    "No usable text could be extracted from this document.")
        db.execute(delete(Chunk).where(Chunk.document_version_id == version_row.id))
        db.add_all(
            Chunk(
                id=uuid.uuid5(version_row.id, str(c.index)),
                tenant_id=doc.tenant_id, collection_id=doc.collection_id, document_id=doc.id,
                document_version_id=version_row.id, chunk_index=c.index, text=c.text,
                token_count=c.token_count, char_start=c.char_start, char_end=c.char_end,
                page_start=c.page_start, page_end=c.page_end, content_hash=c.content_hash,
                metadata_json={"tokenizer": get_tokenizer().name},
            )
            for c in chunks
        )
        rec.details = {"chunks": len(chunks), "tokens": sum(c.token_count for c in chunks),
                       "chunk_size": settings.chunk_size_tokens,
                       "overlap": settings.chunk_overlap_tokens}

    index_document_version(ctx, version_row.id)

    with ctx.stage(PipelineStage.FINALIZE) as rec:
        doc = _load_document(ctx, document_id)
        old_versions = db.scalars(select(DocumentVersion.id).where(
            DocumentVersion.document_id == doc.id, DocumentVersion.id != version_row.id)).all()
        delete_document_vectors(doc.tenant_id, doc.id, except_version_id=version_row.id)
        if old_versions:
            db.execute(delete(Chunk).where(Chunk.document_version_id.in_(old_versions)))
            db.execute(delete(DocumentVersion).where(DocumentVersion.id.in_(old_versions)))
        ocr_pages = sum(1 for p in result.pages if p.method == "ocr")
        doc.status = DocumentStatus.INDEXED
        doc.current_version_id = version_row.id
        doc.page_count = result.page_count
        doc.extracted_chars = sum(len(t) for _, t in cleaned)
        doc.chunk_count = len(chunks)
        doc.token_count = sum(c.token_count for c in chunks)
        doc.extraction_method = result.method
        doc.ocr_page_count = ocr_pages
        doc.quality_score = report.score
        doc.warnings = list(dict.fromkeys(warnings))
        doc.pipeline_version = PIPELINE_VERSION
        doc.indexed_at = datetime.now(UTC)
        version_row = db.merge(version_row)
        version_row.status = "indexed"
        rec.details = {"chunks": len(chunks), "superseded_versions": len(old_versions)}
    log.info("document_indexed", extra={"document_id": str(doc.id), "chunks": len(chunks)})
