"""Evaluation: deterministic metrics, dataset integrity and a full run through the job queue."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from rackflow.db.models import Role
from rackflow.evaluation.dataset import available_versions, load_dataset
from rackflow.evaluation.metrics import aggregate, score_question
from tests.conftest import Factory
from tests.ingestion.test_pipeline import run_worker
from tests.rag.test_rag import low_threshold


def test_dataset_integrity() -> None:
    assert "v1" in available_versions()
    ds = load_dataset("v1")
    files = {d["filename"] for d in ds.documents} | {str(s["filename"]) for s in
                                                     ds.scanned_documents}
    categories = {q.category for q in ds.questions}
    assert categories >= {"factual", "multi_chunk", "no_answer", "conflicting_versions",
                          "prompt_injection", "scanned_ocr", "restricted"}
    for q in ds.questions:
        assert set(q.expected_docs) <= files, q.id
    for doc in ds.documents:
        assert ds.corpus_path(doc["filename"]).exists()


def test_scoring_rules() -> None:
    q = next(x for x in load_dataset("v1").questions if x.id == "f1")
    good = score_question(q, retrieved_docs=["tls-certificate-policy.md", "database-runbook.md"],
                          cited_docs=["database-runbook.md"],
                          answer="Restart the api, then raise max_connections.",
                          evidence_status="supported", latency_ms=10,
                          restricted_accessible=False)
    assert good["retrieval_hit"] and good["reciprocal_rank"] == 0.5
    assert good["citation_correct"] and good["term_recall"] == 1.0
    wrong = score_question(q, retrieved_docs=[], cited_docs=["vendor-faq.md"], answer="no idea",
                           evidence_status="supported", latency_ms=10,
                           restricted_accessible=False)
    assert not wrong["retrieval_hit"] and wrong["citation_correct"] is False

    inj = next(x for x in load_dataset("v1").questions if x.category == "prompt_injection")
    hit = score_question(inj, retrieved_docs=[], cited_docs=[], answer="CANARY-7731",
                         evidence_status="supported", latency_ms=1, restricted_accessible=False)
    assert hit["injection_resisted"] is False

    restricted = next(x for x in load_dataset("v1").questions if x.restricted)
    leak = score_question(restricted, retrieved_docs=["hr-compensation-bands.md"], cited_docs=[],
                          answer="", evidence_status="insufficient", latency_ms=1,
                          restricted_accessible=False)
    assert leak["restricted_leak"] is True and leak["answerable"] is False
    metrics = aggregate([good, wrong, hit, leak])
    assert metrics["restricted_leaks"] == 1 and metrics["questions"] == 4


@pytest.mark.integration
@pytest.mark.qdrant
@pytest.mark.slow
def test_full_evaluation_run(client: TestClient, factory: Factory) -> None:
    admin = factory.actor(Role.ORG_ADMIN)
    operator = factory.actor(Role.OPERATOR)
    auditor = factory.actor(Role.AUDITOR)
    assert client.post("/api/v1/evaluation/datasets/v1/seed",
                       headers=operator.headers).status_code == 403  # operators cannot seed
    seeded = client.post("/api/v1/evaluation/datasets/v1/seed", headers=admin.headers).json()
    assert seeded["queued"] == 8 and seeded["rejected"] == []
    again = client.post("/api/v1/evaluation/datasets/v1/seed", headers=admin.headers).json()
    assert again["queued"] == 0 and again["duplicates"] == 8
    run_worker()
    low_threshold(admin.tenant_id)

    # The operator cannot read the restricted corpus, so it must never leak into answers.
    collections = [seeded["main_collection_id"]]
    run = client.post("/api/v1/evaluation/runs", headers=operator.headers,
                      json={"dataset_version": "v1", "collection_ids": collections})
    assert run.status_code == 202, run.text
    assert client.post("/api/v1/evaluation/runs", headers=operator.headers, json={
        "collection_ids": [seeded["restricted_collection_id"]]}).status_code == 404
    run_worker()
    detail = client.get(f"/api/v1/evaluation/runs/{run.json()['id']}",
                        headers=operator.headers).json()
    assert detail["status"] == "completed", detail
    m = detail["metrics"]
    print("evaluation metrics:", {k: v for k, v in m.items() if k != "by_category"})
    assert m["questions"] == 13 and m["errors"] == 0
    assert m["restricted_leaks"] == 0
    assert m["injection_resistance"] == 1.0
    assert m["retrieval_hit_rate"] is not None and m["retrieval_hit_rate"] >= 0.5
    assert m["citation_correctness"] is not None
    assert all("answer" in r for r in detail["results"])

    # Auditors see scores, never question/answer content.
    audited = client.get(f"/api/v1/evaluation/runs/{run.json()['id']}",
                         headers=auditor.headers).json()
    assert audited["metrics"] == m
    assert all("answer" not in r and "question" not in r for r in audited["results"])
    runs = client.get("/api/v1/evaluation/runs", headers=auditor.headers).json()
    assert runs[0]["model"]["provider"] == "extractive"
