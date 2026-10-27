"""Provider interfaces (Docs/ARCHITECTURE.md §6). Swapping a provider must not require
rewriting callers. Each concrete module exposes a cached `get_<provider>()` factory:

    rackflow.providers.storage.get_object_storage()      -> ObjectStorage
    rackflow.providers.extractors.get_extractor(type)    -> TextExtractor
    rackflow.providers.ocr.get_ocr_provider()            -> OCRProvider | None
    rackflow.providers.tokenizer.get_tokenizer()         -> Tokenizer
    rackflow.providers.embeddings.get_embedding_provider() -> EmbeddingProvider
    rackflow.providers.vectorstore.get_vector_store()    -> VectorStore
    rackflow.providers.chat.get_chat_provider()          -> ChatModelProvider
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, runtime_checkable

# --------------------------------------------------------------------- storage


@runtime_checkable
class ObjectStorage(Protocol):
    def put(self, key: str, data: bytes) -> None: ...
    def get(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...  # idempotent: missing key is not an error
    def exists(self, key: str) -> bool: ...


# ------------------------------------------------------------------ extraction


@dataclass(slots=True)
class ExtractedPage:
    page_number: int  # 1-based; 1 for formats without pages
    text: str
    method: Literal["text", "ocr", "none"]
    ocr_confidence: float | None = None


@dataclass(slots=True)
class ExtractionResult:
    pages: list[ExtractedPage]
    page_count: int
    warnings: list[str] = field(default_factory=list)

    @property
    def method(self) -> str:
        methods = {p.method for p in self.pages if p.method != "none"}
        if not methods:
            return "none"
        return methods.pop() if len(methods) == 1 else "mixed"


class TextExtractor(Protocol):
    def extract(self, data: bytes, *, max_pages: int) -> ExtractionResult: ...


class OCRProvider(Protocol):
    name: str

    def ocr_image(self, image_png: bytes) -> tuple[str, float]:
        """Return (text, mean confidence 0..1)."""
        ...


class Tokenizer(Protocol):
    name: str

    def count(self, text: str) -> int: ...


# ------------------------------------------------------------- embeddings/vector


class EmbeddingProvider(Protocol):
    model_name: str
    dimension: int

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]: ...
    def embed_query(self, text: str) -> list[float]: ...


@dataclass(slots=True)
class VectorRecord:
    id: uuid.UUID  # == chunk id (deterministic → idempotent upserts)
    vector: list[float]
    payload: dict[str, Any]  # tenant_id, collection_id, document_id, version id, chunk_index…


@dataclass(slots=True)
class VectorFilter:
    tenant_id: uuid.UUID  # mandatory — there is no unscoped search
    collection_ids: Sequence[uuid.UUID]
    document_ids: Sequence[uuid.UUID] | None = None


@dataclass(slots=True)
class VectorHit:
    id: uuid.UUID
    score: float
    payload: dict[str, Any]


class VectorStore(Protocol):
    def ensure_collection(self, dimension: int) -> None: ...
    def upsert(self, records: Sequence[VectorRecord]) -> None: ...
    def search(
        self, vector: Sequence[float], flt: VectorFilter, *, limit: int, score_threshold: float
    ) -> list[VectorHit]: ...
    def delete_document(self, tenant_id: uuid.UUID, document_id: uuid.UUID) -> None: ...
    def count_document(self, tenant_id: uuid.UUID, document_id: uuid.UUID) -> int: ...
    def health(self) -> bool: ...


class Reranker(Protocol):
    def rerank(self, query: str, texts: Sequence[str]) -> list[float]: ...


# ------------------------------------------------------------------- chat model


@dataclass(slots=True)
class ChatTurn:
    role: Literal["user", "assistant"]
    content: str


@dataclass(slots=True)
class ChatCompletion:
    text: str
    provider: str
    model: str
    latency_ms: int
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


@dataclass(slots=True)
class ProviderHealth:
    ok: bool
    provider: str
    model: str
    deployment_mode: Literal["local", "remote", "builtin"]
    detail: str = ""
    latency_ms: int | None = None


class ChatModelProvider(Protocol):
    provider: str
    model: str
    deployment_mode: Literal["local", "remote", "builtin"]

    def complete(
        self,
        *,
        system: str,
        turns: Sequence[ChatTurn],
        max_tokens: int,
        temperature: float,
    ) -> ChatCompletion: ...

    def health(self) -> ProviderHealth: ...
