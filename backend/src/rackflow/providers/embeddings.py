"""Embedding providers (FR-020). Default: local FastEmbed ONNX model — no document egress."""

from __future__ import annotations

import hashlib
import math
import os
import re
from collections.abc import Sequence
from functools import lru_cache
from pathlib import Path

from rackflow.core.config import REPO_ROOT, get_settings

_WORD = re.compile(r"\w+", re.UNICODE)


class HashEmbeddingProvider:
    """TEST ONLY — deterministic feature hashing of word unigrams/bigrams. Not semantic.
    Refused in production by configuration validation."""

    model_name = "hash-test-only-384"
    dimension = 384

    def _embed(self, text: str) -> list[float]:
        words = _WORD.findall(text.lower())
        features = words + [f"{a}_{b}" for a, b in zip(words, words[1:], strict=False)]
        vec = [0.0] * self.dimension
        for feat in features:
            digest = hashlib.blake2b(feat.encode("utf-8"), digest_size=8).digest()
            idx = int.from_bytes(digest[:4], "little") % self.dimension
            vec[idx] += 1.0 if digest[4] & 1 else -1.0
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return [self._embed(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._embed(text)


class FastEmbedProvider:
    def __init__(self, model_name: str, cache_dir: str) -> None:
        from fastembed import TextEmbedding

        self.model_name = model_name
        self._model = TextEmbedding(model_name=model_name, cache_dir=cache_dir)
        self.dimension = len(next(iter(self._model.query_embed("dimension probe"))))

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return [v.tolist() for v in self._model.passage_embed(list(texts), batch_size=32)]

    def embed_query(self, text: str) -> list[float]:
        return next(iter(self._model.query_embed(text))).tolist()


def model_cache_dir() -> str:
    path = os.environ.get("FASTEMBED_CACHE_PATH") or str(REPO_ROOT / ".data" / "models")
    Path(path).mkdir(parents=True, exist_ok=True)
    return path


@lru_cache(maxsize=1)
def get_embedding_provider() -> HashEmbeddingProvider | FastEmbedProvider:
    settings = get_settings()
    if settings.embedding_provider == "hash":
        return HashEmbeddingProvider()
    return FastEmbedProvider(settings.embedding_model, model_cache_dir())
