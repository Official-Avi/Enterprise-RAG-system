"""Document routes: file-name search treats _ and % literally, downloads keep non-ASCII names, and
everyone the permission matrix lets retry a failed document actually can."""

from __future__ import annotations

from urllib.parse import unquote

import pytest
from fastapi.testclient import TestClient

from rackflow.api.routers.documents import content_disposition
from rackflow.db.models import Role
from tests.conftest import Actor, Factory
from tests.fixtures import make_blank_pdf
from tests.ingestion.test_pipeline import make_collection, run_worker, upload

pytestmark = [pytest.mark.integration]


def names(client: TestClient, actor: Actor, q: str) -> set[str]:
    r = client.get("/api/v1/documents", params={"q": q}, headers=actor.headers)
    assert r.status_code == 200, r.text
    return {d["filename"] for d in r.json()["items"]}


def test_search_treats_wildcards_literally(client: TestClient, factory: Factory) -> None:
    eng = factory.actor(Role.ENGINEER)
    cid = make_collection(client, eng)
    upload(client, eng, cid, [
        ("under_score.md", b"# a\n\none"),
        ("underXscore.md", b"# b\n\ntwo"),
        ("100%done.md", b"# c\n\nthree"),
        ("plain.md", b"# d\n\nfour"),
    ])
    assert names(client, eng, "under_score") == {"under_score.md"}
    assert names(client, eng, "UNDER_SCORE") == {"under_score.md"}
    assert names(client, eng, "_") == {"under_score.md"}
    assert names(client, eng, "%") == {"100%done.md"}
    assert names(client, eng, "100%") == {"100%done.md"}
    assert names(client, eng, "under") == {"under_score.md", "underXscore.md"}
    # The escape character itself is literal too.
    assert names(client, eng, "/") == set()
    assert names(client, eng, "\\") == set()


@pytest.mark.parametrize(("name", "fallback", "encoded"), [
    ("plain.md", "plain.md", "plain.md"),
    ("रिपोर्ट7095.md", "7095.md",
     "%E0%A4%B0%E0%A4%BF%E0%A4%AA%E0%A5%8B%E0%A4%B0%E0%A5%8D%E0%A4%9F7095.md"),
    ("रिपोर्ट.md", "document.md",
     "%E0%A4%B0%E0%A4%BF%E0%A4%AA%E0%A5%8B%E0%A4%B0%E0%A5%8D%E0%A4%9F.md"),
    ("报告", "document", "%E6%8A%A5%E5%91%8A"),
    ("café.pdf", "cafe.pdf", "caf%C3%A9.pdf"),
    ('we"ird\\ 50%;\r\nX-Evil: 1.md', "weird 50;X-Evil: 1.md",
     "we%22ird%5C%2050%25%3B%0D%0AX-Evil%3A%201.md"),
])
def test_content_disposition(name: str, fallback: str, encoded: str) -> None:
    assert content_disposition(name) == (
        f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"
    )


@pytest.mark.parametrize("name", ["रिपोर्ट7095.md", "library-weird #1 & (copy) é 7.md"])
def test_download_keeps_the_file_name(client: TestClient, factory: Factory, name: str) -> None:
    eng = factory.actor(Role.ENGINEER)
    cid = make_collection(client, eng)
    body = f"# {name}\n\nbody".encode()
    item = upload(client, eng, cid, [(name, body)])[0]
    listed = client.get(f"/api/v1/documents/{item['document_id']}", headers=eng.headers).json()
    r = client.get(f"/api/v1/documents/{item['document_id']}/download", headers=eng.headers)
    assert r.status_code == 200 and r.content == body
    header = r.headers["content-disposition"]
    assert 'filename="' in header
    assert unquote(header.split("filename*=UTF-8''", 1)[1]) == listed["filename"] == name


def failed_document(client: TestClient, owner: Actor, visibility: str = "tenant") -> str:
    cid = make_collection(client, owner, f"Retry {visibility}", visibility)
    item = upload(client, owner, cid, [("blank.pdf", make_blank_pdf())])[0]
    run_worker()
    doc = client.get(f"/api/v1/documents/{item['document_id']}", headers=owner.headers).json()
    assert doc["status"] == "failed"
    return str(item["document_id"])


@pytest.mark.qdrant
def test_operator_can_retry_a_failed_document(client: TestClient, factory: Factory) -> None:
    owner = factory.actor(Role.ENGINEER)
    operator = factory.actor(Role.OPERATOR)
    doc_id = failed_document(client, owner)
    r = client.post(f"/api/v1/documents/{doc_id}/retry", headers=operator.headers)
    assert r.status_code == 202, r.text
    assert r.json()["status"] == "queued"
    # Retrying twice is refused like it is for everyone else.
    assert client.post(f"/api/v1/documents/{doc_id}/retry",
                       headers=operator.headers).status_code == 409


@pytest.mark.qdrant
def test_retry_keeps_its_access_checks(client: TestClient, factory: Factory) -> None:
    owner = factory.actor(Role.ENGINEER)
    restricted = failed_document(client, owner, "restricted")
    tenant_wide = failed_document(client, owner, "tenant")
    # An operator with no access to a restricted collection learns nothing about it.
    operator = factory.actor(Role.OPERATOR)
    assert client.post(f"/api/v1/documents/{restricted}/retry",
                       headers=operator.headers).status_code == 404
    # Other tenants can't touch it. Auditors don't hold the permission at all.
    outsider = factory.actor(Role.OPERATOR, tenant="globex")
    assert client.post(f"/api/v1/documents/{tenant_wide}/retry",
                       headers=outsider.headers).status_code == 404
    auditor = factory.actor(Role.AUDITOR)
    assert client.post(f"/api/v1/documents/{tenant_wide}/retry",
                       headers=auditor.headers).status_code == 403
    assert client.get(f"/api/v1/documents/{tenant_wide}",
                      headers=owner.headers).json()["status"] == "failed"
