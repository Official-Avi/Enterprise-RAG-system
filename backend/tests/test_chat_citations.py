"""What a saved answer says about its sources: citations to deleted documents stay attributed and
flagged, access is still re-checked on every read, and citations name the page the text is on."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from rackflow.db.models import Role
from tests.conftest import Actor, Factory
from tests.fixtures import make_text_pdf
from tests.ingestion.test_pipeline import run_worker
from tests.rag.test_rag import ask, indexed_collection

pytestmark = [pytest.mark.integration, pytest.mark.qdrant]


def saved_citations(client: TestClient, actor: Actor, sid: str) -> list[dict[str, Any]]:
    detail = client.get(f"/api/v1/chat/sessions/{sid}", headers=actor.headers)
    assert detail.status_code == 200, detail.text
    return list(detail.json()["messages"][1]["citations"])


def only_document(client: TestClient, actor: Actor) -> str:
    return str(client.get("/api/v1/documents", headers=actor.headers).json()["items"][0]["id"])


def test_live_citation_is_not_flagged(client: TestClient, factory: Factory) -> None:
    eng = factory.actor(Role.ENGINEER)
    cid = indexed_collection(client, eng)
    sid, r = ask(client, eng, [cid])
    assert r.json()["citations"]
    assert all(c["document_deleted"] is False for c in r.json()["citations"])
    assert saved_citations(client, eng, sid) == r.json()["citations"]


def test_deleted_document_keeps_its_attribution(client: TestClient, factory: Factory) -> None:
    eng = factory.actor(Role.ENGINEER)
    cid = indexed_collection(client, eng)
    sid, r = ask(client, eng, [cid])
    before = r.json()["citations"]
    assert before
    doc_id = only_document(client, eng)

    def check() -> None:
        after = saved_citations(client, eng, sid)
        assert [c["marker"] for c in after] == [c["marker"] for c in before]
        for was, now in zip(before, after, strict=True):
            assert now["document_deleted"] is True
            assert now["document_id"] == doc_id
            assert now["filename"] == "runbook.pdf"
            # Only what the citation already stored; the chunk link is gone with the document.
            assert (now["page"], now["quote"]) == (was["page"], was["quote"])
            assert now["chunk_id"] is None

    # Delete requested, cleanup job not run yet: the document is on its way out.
    assert client.delete(f"/api/v1/documents/{doc_id}", headers=eng.headers).status_code == 202
    check()
    # Cleanup finished: tombstone only.
    run_worker()
    check()
    # The file itself stays gone.
    assert client.get(f"/api/v1/documents/{doc_id}/download",
                      headers=eng.headers).status_code == 404


def test_deleted_document_stays_hidden_after_access_revoked(client: TestClient,
                                                            factory: Factory) -> None:
    admin = factory.actor(Role.ORG_ADMIN)
    eng = factory.actor(Role.ENGINEER)
    cid = indexed_collection(client, admin)
    sid, r = ask(client, eng, [cid])
    assert r.json()["citations"]
    doc_id = only_document(client, admin)
    assert client.delete(f"/api/v1/documents/{doc_id}", headers=admin.headers).status_code == 202
    run_worker()
    assert all(c["document_deleted"] for c in saved_citations(client, eng, sid))
    assert client.patch(f"/api/v1/collections/{cid}", json={"visibility": "restricted"},
                        headers=admin.headers).status_code == 200
    assert saved_citations(client, eng, sid) == []


def test_saved_citations_are_not_readable_by_other_users(client: TestClient,
                                                         factory: Factory) -> None:
    eng = factory.actor(Role.ENGINEER)
    cid = indexed_collection(client, eng)
    sid, _ = ask(client, eng, [cid])
    assert client.delete(f"/api/v1/documents/{only_document(client, eng)}",
                         headers=eng.headers).status_code == 202
    run_worker()
    colleague = factory.actor(Role.ENGINEER)
    outsider = factory.actor(Role.ORG_ADMIN, tenant="globex")
    for other in (colleague, outsider):
        assert client.get(f"/api/v1/chat/sessions/{sid}", headers=other.headers).status_code == 404


def test_citation_is_a_bare_stub_once_the_document_row_is_gone(client: TestClient,
                                                               factory: Factory) -> None:
    """Deleting the collection removes the tombstone, so access can no longer be re-checked. The
    marker stays so the answer doesn't credit another source, but nothing else is returned."""
    eng = factory.actor(Role.ENGINEER)
    cid = indexed_collection(client, eng)
    sid, r = ask(client, eng, [cid])
    before = r.json()["citations"]
    assert before
    doc_id = only_document(client, eng)
    assert client.delete(f"/api/v1/documents/{doc_id}", headers=eng.headers).status_code == 202
    run_worker()
    # The chat's scope is empty now, but reading its history still works.
    assert client.delete(f"/api/v1/collections/{cid}", headers=eng.headers).status_code == 204

    stubs = saved_citations(client, eng, sid)
    assert [c["marker"] for c in stubs] == [c["marker"] for c in before]
    for stub in stubs:
        assert stub["document_deleted"] is True
        assert stub["document_id"] is None and stub["chunk_id"] is None
        assert stub["filename"] == "" and stub["quote"] == ""
        assert stub["page"] is None and stub["score"] is None


def test_saved_answer_returns_the_retrieved_count(client: TestClient, factory: Factory) -> None:
    eng = factory.actor(Role.ENGINEER)
    cid = indexed_collection(client, eng)
    sid, r = ask(client, eng, [cid])
    messages = client.get(f"/api/v1/chat/sessions/{sid}", headers=eng.headers).json()["messages"]
    assert messages[0]["retrieved_count"] is None  # the user's own message
    assert messages[1]["retrieved_count"] == r.json()["retrieved_count"] > 0


@pytest.mark.parametrize(("question", "page"), [
    ("What pressure does the relief valve open at?", 2),
    ("How often must the intake filter be swapped?", 3),
    ("What grade of compressor oil is required?", 4),
])
def test_citation_names_the_page_the_fact_is_on(client: TestClient, factory: Factory,
                                                question: str, page: int) -> None:
    """Every page fits in one chunk's budget, so pages used to be packed together and cited by the
    first page in the chunk."""
    pdf = make_text_pdf([
        "Compressor commissioning\nCommissioning requires two engineers on site.",
        "Valves\nThe relief valve will open at a pressure of 14.2 bar.",
        "Filters\nThe intake filter must be swapped every 620 hours.",
        "Lubrication\nThe required compressor oil is grade ISO VG 46.",
    ])
    eng = factory.actor(Role.ENGINEER)
    cid = indexed_collection(client, eng, files=[("compressor.pdf", pdf)])
    _, r = ask(client, eng, [cid], question)
    citations = r.json()["citations"]
    assert citations, r.text
    best = max(citations, key=lambda c: c["score"])
    assert best["page"] == page
