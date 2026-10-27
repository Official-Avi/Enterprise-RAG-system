"""Live end-to-end smoke test against a running stack (API + worker + PostgreSQL + Qdrant).

Usage (from backend/):
    .venv/Scripts/python.exe ../scripts/dev/smoke_e2e.py --email engineer@acme.example.com
Password is read from RACKFLOW_SMOKE_PASSWORD or <repo>/.data/demo-password.txt.

Steps: login → create collection → upload a generated runbook PDF → wait until indexed →
ask a question → verify the answer cites the uploaded document → print the result.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import uuid
from pathlib import Path

import httpx

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))
from tests.fixtures import make_text_pdf  # noqa: E402

RUNBOOK_PAGES = [
    "PostgreSQL Operations Runbook\n"
    "Symptom: API requests fail with 'connection pool exhausted'.\n"
    "Resolution: restart the rackflow-api service, then increase max_connections\n"
    "in postgresql.conf from 100 to 200 and reload PostgreSQL.",
    "Replica failover procedure\n"
    "1. Confirm the primary is unreachable for more than 60 seconds.\n"
    "2. Promote the standby with: pg_ctl promote -D /var/lib/postgresql/data\n"
    "3. Update the db.internal DNS record to the new primary.",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://127.0.0.1:8000")
    ap.add_argument("--email", default="engineer@acme.example.com")
    ap.add_argument("--question", default="How do I fix a connection pool exhausted error?")
    args = ap.parse_args()
    password = os.environ.get("RACKFLOW_SMOKE_PASSWORD") or \
        (REPO / ".data" / "demo-password.txt").read_text().strip()

    c = httpx.Client(base_url=f"{args.base_url}/api/v1", timeout=120)
    login = c.post("/auth/login", json={"email": args.email, "password": password, "mode": "token"})
    login.raise_for_status()
    c.headers["Authorization"] = f"Bearer {login.json()['token']}"
    print(f"[ok] logged in as {args.email} ({login.json()['role']})")

    col = c.post("/collections", json={"name": f"Smoke {uuid.uuid4().hex[:6]}"})
    col.raise_for_status()
    cid = col.json()["id"]
    print(f"[ok] collection {cid}")

    up = c.post(f"/collections/{cid}/documents",
                files=[("files", ("postgres-runbook.pdf", make_text_pdf(RUNBOOK_PAGES)))])
    up.raise_for_status()
    item = up.json()["items"][0]
    assert item["status"] == "queued", item
    doc_id = item["document_id"]
    print(f"[ok] uploaded document {doc_id}, job {item['job_id']}")

    t0 = time.time()
    while True:
        doc = c.get(f"/documents/{doc_id}").json()
        if doc["status"] in ("indexed", "failed"):
            break
        if time.time() - t0 > 180:
            print("[FAIL] timed out waiting for indexing (is the worker running?)")
            return 1
        time.sleep(1)
    if doc["status"] != "indexed":
        print(f"[FAIL] processing failed: {doc['latest_job']}")
        return 1
    print(f"[ok] indexed in {time.time() - t0:.1f}s: {doc['page_count']} pages, "
          f"{doc['chunk_count']} chunks, embeddings={doc['embedding_model']}")

    s = c.post("/chat/sessions", json={"collection_ids": [cid]})
    s.raise_for_status()
    ans = c.post(f"/chat/sessions/{s.json()['id']}/messages", json={"message": args.question})
    ans.raise_for_status()
    body = ans.json()
    print(f"\nQ: {args.question}\nA: {body['answer']}\n")
    print(f"evidence_status={body['evidence_status']} model={body['model']} "
          f"latency={body['latency_ms']}ms retrieved={body['retrieved_count']}")
    for cit in body["citations"]:
        print(f"  [{cit['marker']}] {cit['filename']} p.{cit['page']} "
              f"score={cit['score']}: {cit['quote']!r}")

    ok = (body["evidence_status"] == "supported" and body["citations"]
          and all(ci["document_id"] == doc_id for ci in body["citations"]))
    print("\n[ok] SMOKE TEST PASSED" if ok else "\n[FAIL] SMOKE TEST FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
