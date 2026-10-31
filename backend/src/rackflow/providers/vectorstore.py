"""Qdrant vector-store adapter. Every query is tenant- and collection-filtered; the vector store
holds IDs and minimal metadata only (no chunk text). It is never the only authorization check:
retrieval re-validates hits against PostgreSQL."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from functools import lru_cache

from qdrant_client import QdrantClient, models

from rackflow.core.config import get_settings
from rackflow.providers.interfaces import VectorFilter, VectorHit, VectorRecord

_INDEXED_FIELDS = ("tenant_id", "collection_id", "document_id", "document_version_id")


class VectorDimensionMismatch(RuntimeError):
    pass


class QdrantVectorStore:
    def __init__(self, client: QdrantClient, collection: str) -> None:
        self.client = client
        self.collection = collection
        self._ready = False

    def ensure_collection(self, dimension: int) -> None:
        # Existence is re-checked on every call (one cheap request per indexed document): a
        # collection deleted while the worker runs is recreated instead of failing every upsert.
        exists = self.client.collection_exists(self.collection)
        if self._ready and exists:
            return
        if not exists:
            self.client.create_collection(
                self.collection,
                vectors_config=models.VectorParams(size=dimension, distance=models.Distance.COSINE),
            )
            for field in _INDEXED_FIELDS:
                self.client.create_payload_index(
                    self.collection, field_name=field,
                    field_schema=models.PayloadSchemaType.KEYWORD,
                )
        else:
            info = self.client.get_collection(self.collection)
            vectors = info.config.params.vectors
            size = vectors.size if isinstance(vectors, models.VectorParams) else None
            if size is not None and size != dimension:
                raise VectorDimensionMismatch(
                    f"collection dimension {size} != embedding dimension {dimension}"
                )
        self._ready = True

    def upsert(self, records: Sequence[VectorRecord]) -> None:
        if not records:
            return
        self.client.upsert(
            self.collection,
            points=[models.PointStruct(id=str(r.id), vector=r.vector, payload=r.payload)
                    for r in records],
            wait=True,
        )

    @staticmethod
    def _doc_filter(tenant_id: uuid.UUID, document_id: uuid.UUID) -> list[models.Condition]:
        return [
            models.FieldCondition(key="tenant_id", match=models.MatchValue(value=str(tenant_id))),
            models.FieldCondition(key="document_id",
                                  match=models.MatchValue(value=str(document_id))),
        ]

    def search(
        self, vector: Sequence[float], flt: VectorFilter, *, limit: int, score_threshold: float
    ) -> list[VectorHit]:
        if not flt.collection_ids or not self.client.collection_exists(self.collection):
            return []
        must: list[models.Condition] = [
            models.FieldCondition(key="tenant_id",
                                  match=models.MatchValue(value=str(flt.tenant_id))),
            models.FieldCondition(
                key="collection_id",
                match=models.MatchAny(any=[str(c) for c in flt.collection_ids]),
            ),
        ]
        if flt.document_ids:
            must.append(models.FieldCondition(
                key="document_id", match=models.MatchAny(any=[str(d) for d in flt.document_ids])
            ))
        result = self.client.query_points(
            self.collection, query=list(vector), query_filter=models.Filter(must=must),
            limit=limit, score_threshold=score_threshold, with_payload=True,
        )
        return [VectorHit(id=uuid.UUID(str(p.id)), score=float(p.score), payload=p.payload or {})
                for p in result.points]

    def delete_document(
        self, tenant_id: uuid.UUID, document_id: uuid.UUID,
        *, except_version_id: uuid.UUID | None = None,
    ) -> None:
        if not self.client.collection_exists(self.collection):
            return
        must_not: list[models.Condition] = []
        if except_version_id is not None:
            must_not.append(models.FieldCondition(
                key="document_version_id", match=models.MatchValue(value=str(except_version_id))
            ))
        self.client.delete(
            self.collection,
            points_selector=models.FilterSelector(filter=models.Filter(
                must=self._doc_filter(tenant_id, document_id), must_not=must_not or None,
            )),
            wait=True,
        )

    def count_document(
        self, tenant_id: uuid.UUID, document_id: uuid.UUID,
        *, version_id: uuid.UUID | None = None,
    ) -> int:
        if not self.client.collection_exists(self.collection):
            return 0
        must = self._doc_filter(tenant_id, document_id)
        if version_id is not None:
            must.append(models.FieldCondition(
                key="document_version_id", match=models.MatchValue(value=str(version_id))
            ))
        return self.client.count(self.collection, count_filter=models.Filter(must=must),
                                 exact=True).count

    def health(self) -> bool:
        self.client.get_collections()
        return True

    def collection_exists(self) -> bool:
        return bool(self.client.collection_exists(self.collection))


@lru_cache(maxsize=1)
def get_vector_store() -> QdrantVectorStore:
    settings = get_settings()
    secret = settings.vector_store_api_key
    key = secret.get_secret_value() if secret else None
    client = QdrantClient(url=settings.vector_store_url, api_key=key, timeout=10)
    return QdrantVectorStore(client, settings.vector_collection)
