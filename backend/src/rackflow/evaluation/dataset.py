"""Versioned evaluation datasets shipped with the package (evaluation/datasets/<version>/)."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

DATASETS_DIR = Path(__file__).parent / "datasets"
_VERSION_RE = re.compile(r"^v\d{1,3}$")


@dataclass(frozen=True, slots=True)
class Question:
    id: str
    category: str
    question: str
    expected_docs: tuple[str, ...]
    expected_terms: tuple[str, ...]
    forbidden_terms: tuple[str, ...] = ()
    restricted: bool = False

    @property
    def answerable(self) -> bool:
        return bool(self.expected_docs)


@dataclass(frozen=True, slots=True)
class Dataset:
    version: str
    description: str
    questions: tuple[Question, ...]
    documents: tuple[dict[str, str], ...] = field(default_factory=tuple)
    scanned_documents: tuple[dict[str, object], ...] = field(default_factory=tuple)

    def corpus_path(self, filename: str) -> Path:
        path = (DATASETS_DIR / self.version / "corpus" / filename).resolve()
        if not path.is_relative_to(DATASETS_DIR.resolve()):
            raise ValueError("invalid corpus path")
        return path


def available_versions() -> list[str]:
    return sorted(p.name for p in DATASETS_DIR.iterdir()
                  if p.is_dir() and _VERSION_RE.match(p.name) and (p / "questions.json").exists())


@lru_cache(maxsize=8)
def load_dataset(version: str) -> Dataset:
    if version not in available_versions():
        raise KeyError(version)
    raw = json.loads((DATASETS_DIR / version / "questions.json").read_text(encoding="utf-8"))
    questions = tuple(
        Question(id=q["id"], category=q["category"], question=q["question"],
                 expected_docs=tuple(q.get("expected_docs", [])),
                 expected_terms=tuple(q.get("expected_terms", [])),
                 forbidden_terms=tuple(q.get("forbidden_terms", [])),
                 restricted=bool(q.get("restricted", False)))
        for q in raw["questions"]
    )
    return Dataset(version=raw["version"], description=raw.get("description", ""),
                   questions=questions, documents=tuple(raw.get("documents", [])),
                   scanned_documents=tuple(raw.get("scanned_documents", [])))
