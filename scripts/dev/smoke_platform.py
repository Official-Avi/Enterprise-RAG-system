"""Live smoke test for enterprise features through the web proxy (cookie session + CSRF).

Usage (from backend/, with API, worker and web running):
    .venv/Scripts/python.exe ../scripts/dev/smoke_platform.py [--base-url http://127.0.0.1:3000]

Checks: admin member listing and audit log, tenant settings, simulated infrastructure inventory,
evaluation corpus seeding + indexing, an evaluation run executed by the worker, and that every
console page is served.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx

REPO = Path(__file__).resolve().parents[2]
PAGES = ["/", "/collections", "/documents", "/chat", "/inspector", "/jobs", "/workers", "/models",
         "/evaluation", "/infrastructure", "/admin/users", "/admin/audit", "/admin/settings",
         "/login"]


def login(base: str, email: str, password: str) -> httpx.Client:
    c = httpx.Client(base_url=base, timeout=60, headers={"X-RackFlow-CSRF": "1"})
    r = c.post("/api/v1/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    return c


def wait(predicate, timeout: float, what: str) -> None:  # type: ignore[no-untyped-def]
    t0 = time.time()
    while time.time() - t0 < timeout:
        if predicate():
            return
        time.sleep(1.5)
    raise SystemExit(f"[FAIL] timed out waiting for {what}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://127.0.0.1:3000")
    args = ap.parse_args()
    password = os.environ.get("RACKFLOW_SMOKE_PASSWORD") or \
        (REPO / ".data" / "demo-password.txt").read_text().strip()
    admin = login(args.base_url, "admin@acme.example.com", password)
    operator = login(args.base_url, "operator@acme.example.com", password)
    auditor = login(args.base_url, "auditor@acme.example.com", password)
    print("[ok] admin, operator and auditor signed in through the web proxy (cookie sessions)")

    members = admin.get("/api/v1/admin/users").json()["items"]
    print(f"[ok] members listed: {len(members)}")
    settings = admin.get("/api/v1/settings/tenant").json()
    print(f"[ok] tenant settings: top_k={settings['effective']['retrieval_top_k']} "
          f"threshold={settings['effective']['retrieval_score_threshold']}")

    subprocess.run([sys.executable, "-m", "rackflow.cli", "seed-infra", "--tenant", "acme"],
                   check=True, cwd=REPO / "backend")
    overview = operator.get("/api/v1/infrastructure/overview").json()
    racks = operator.get("/api/v1/infrastructure/racks").json()["items"]
    print(f"[ok] infrastructure: {len(racks)} racks; by source {overview['racks']}; "
          f"{len(overview['platform_processes'])} live worker process(es) integration-reported")

    seeded = admin.post("/api/v1/evaluation/datasets/v1/seed").json()
    print(f"[ok] evaluation corpus: {seeded['queued']} queued, {seeded['duplicates']} present")
    main_id = seeded["main_collection_id"]

    def indexed() -> bool:
        docs = admin.get(f"/api/v1/documents?collection_id={main_id}").json()["items"]
        return len(docs) >= 7 and all(d["status"] in ("indexed", "failed") for d in docs)

    wait(indexed, 300, "evaluation corpus indexing")
    print("[ok] evaluation corpus indexed by the worker")

    run = operator.post("/api/v1/evaluation/runs",
                        json={"dataset_version": "v1", "collection_ids": [main_id]}).json()

    def finished() -> bool:
        status = operator.get(f"/api/v1/evaluation/runs/{run['id']}").json()["status"]
        return status in ("completed", "failed", "cancelled")

    wait(finished, 300, "evaluation run")
    detail = operator.get(f"/api/v1/evaluation/runs/{run['id']}").json()
    metrics = {k: v for k, v in detail["metrics"].items() if k != "by_category"}
    print(f"[ok] evaluation run {detail['status']} with {detail['model']}: {metrics}")

    events = auditor.get("/api/v1/admin/audit-events?limit=200").json()["items"]
    actions = sorted({e["action"] for e in events})
    print(f"[ok] audit log visible to auditor: {len(events)} recent events, actions={actions}")
    assert auditor.get("/api/v1/admin/users").status_code == 200
    assert auditor.post("/api/v1/infrastructure/racks", json={"name": "x"}).status_code == 403

    statuses = {p: httpx.get(f"{args.base_url}{p}", timeout=30).status_code for p in PAGES}
    bad = {p: s for p, s in statuses.items() if s != 200}
    print(f"[{'ok' if not bad else 'FAIL'}] console pages served: {len(PAGES) - len(bad)}/"
          f"{len(PAGES)}{' ' + str(bad) if bad else ''}")
    ok = detail["status"] == "completed" and not bad and metrics.get("restricted_leaks") == 0
    print("\n[ok] PLATFORM SMOKE TEST PASSED" if ok else "\n[FAIL] PLATFORM SMOKE TEST FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
