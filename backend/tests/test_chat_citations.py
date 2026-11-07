"""What a saved answer says about its sources: citations to deleted documents stay attributed and
flagged, access is still re-checked on every read, and citations name the page the text is on."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from rackflow.api.routers.chat import ANSWER_WITHHELD_NOTE
from rackflow.db.models import Citation, Role
from rackflow.db.session import session_scope
from tests.conftest import Actor, Factory
from tests.fixtures import make_docx, make_text_pdf
from tests.ingestion.test_pipeline import run_worker
from tests.rag.test_rag import QUESTION, ask, indexed_collection

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


def test_saved_answer_text_is_withheld_after_access_revoked(client: TestClient,
                                                            factory: Factory) -> None:
    """The extractive answer is verbatim document text, so hiding the citations alone leaked it."""
    admin = factory.actor(Role.ORG_ADMIN)
    eng = factory.actor(Role.ENGINEER)
    cid = indexed_collection(client, admin)
    sid, r = ask(client, eng, [cid])
    assert "max_connections" in r.json()["answer"]
    url = f"/api/v1/chat/sessions/{sid}"

    before = client.get(url, headers=eng.headers).json()["messages"][1]
    assert before["content"] == r.json()["answer"] and before["content_withheld"] is False

    assert client.patch(f"/api/v1/collections/{cid}", json={"visibility": "restricted"},
                        headers=admin.headers).status_code == 200
    question, answer = client.get(url, headers=eng.headers).json()["messages"]
    assert question["content"] == QUESTION and question["content_withheld"] is False
    assert answer["content"] == ANSWER_WITHHELD_NOTE and answer["content_withheld"] is True
    assert answer["evidence_status"] is None and answer["citations"] == []

    # The saved answer comes back with the access.
    assert client.patch(f"/api/v1/collections/{cid}", json={"visibility": "tenant"},
                        headers=admin.headers).status_code == 200
    restored = client.get(url, headers=eng.headers).json()["messages"][1]
    assert restored["content"] == r.json()["answer"]
    assert restored["evidence_status"] == "supported" and restored["content_withheld"] is False


def test_answer_is_withheld_once_access_can_no_longer_be_checked(client: TestClient,
                                                                 factory: Factory) -> None:
    eng = factory.actor(Role.ENGINEER)
    cid = indexed_collection(client, eng)
    sid, r = ask(client, eng, [cid])
    assert r.json()["citations"]
    assert client.delete(f"/api/v1/documents/{only_document(client, eng)}",
                         headers=eng.headers).status_code == 202
    run_worker()
    assert client.delete(f"/api/v1/collections/{cid}", headers=eng.headers).status_code == 204
    question, answer = client.get(f"/api/v1/chat/sessions/{sid}",
                                  headers=eng.headers).json()["messages"]
    assert question["content"] == QUESTION
    assert answer["content"] == ANSWER_WITHHELD_NOTE and answer["content_withheld"] is True


def test_answer_from_a_deleted_document_stays_while_access_can_be_checked(
        client: TestClient, factory: Factory) -> None:
    eng = factory.actor(Role.ENGINEER)
    cid = indexed_collection(client, eng)
    sid, r = ask(client, eng, [cid])
    assert client.delete(f"/api/v1/documents/{only_document(client, eng)}",
                         headers=eng.headers).status_code == 202
    run_worker()
    answer = client.get(f"/api/v1/chat/sessions/{sid}", headers=eng.headers).json()["messages"][1]
    assert answer["content"] == r.json()["answer"] and answer["content_withheld"] is False


@pytest.mark.parametrize(("filename", "content"), [
    ("notes.txt", b"Pump Notes\n\nThe Marlowe pump maximum inlet pressure is 9 bar.\n"),
    ("notes.md", b"# Pump Notes\n\nThe Marlowe pump maximum inlet pressure is 9 bar.\n"),
    ("notes.docx", None),
])
def test_formats_without_real_pages_cite_no_page(client: TestClient, factory: Factory,
                                                 filename: str, content: bytes | None) -> None:
    """They are extracted as one page, so every citation used to say page 1."""
    eng = factory.actor(Role.ENGINEER)
    data = content if content is not None else make_docx(
        "Pump Notes", ["The Marlowe pump maximum inlet pressure is 9 bar."])
    cid = indexed_collection(client, eng, files=[(filename, data)])
    sid, r = ask(client, eng, [cid], "What is the Marlowe pump maximum inlet pressure?")
    assert r.json()["citations"], r.text
    assert all(c["page"] is None for c in r.json()["citations"])
    assert all(c["page"] is None for c in saved_citations(client, eng, sid))


def test_citation_saved_with_a_page_on_a_docx_is_returned_without_it(client: TestClient,
                                                                     factory: Factory) -> None:
    eng = factory.actor(Role.ENGINEER)
    data = make_docx("Pump Notes", ["The Marlowe pump maximum inlet pressure is 9 bar."])
    cid = indexed_collection(client, eng, files=[("notes.docx", data)])
    sid, r = ask(client, eng, [cid], "What is the Marlowe pump maximum inlet pressure?")
    cited = [uuid.UUID(c["chunk_id"]) for c in r.json()["citations"]]
    assert cited
    with session_scope() as s:  # what answers saved before this fix hold
        s.execute(update(Citation).where(Citation.chunk_id.in_(cited)).values(page=1))
    assert all(c["page"] is None for c in saved_citations(client, eng, sid))


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
