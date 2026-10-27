"""Logical rack/node/workload registry: provenance rules, authorization, isolation, seeding."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from rackflow.cli import main as cli_main
from rackflow.db.models import Role
from tests.conftest import Factory

pytestmark = pytest.mark.integration
GIB = 1024**3


def test_rack_node_workload_registry(client: TestClient, factory: Factory) -> None:
    op = factory.actor(Role.OPERATOR)
    eng = factory.actor(Role.ENGINEER)
    auditor = factory.actor(Role.AUDITOR)
    outsider = factory.actor(Role.ORG_ADMIN, tenant="globex")

    rack = client.post("/api/v1/infrastructure/racks", headers=op.headers, json={
        "name": "rack-1", "environment": "production", "rack_units": 42})
    assert rack.status_code == 201, rack.text
    rid = rack.json()["id"]
    assert rack.json()["state_source"] == "manual"
    # Clients can never claim live integration data.
    assert client.post("/api/v1/infrastructure/racks", headers=op.headers, json={
        "name": "rack-x", "state_source": "integration"}).status_code == 422
    assert client.post("/api/v1/infrastructure/racks", headers=eng.headers,
                       json={"name": "rack-2"}).status_code == 403

    bad = client.post("/api/v1/infrastructure/nodes", headers=op.headers, json={
        "name": "n0", "rack_id": rid, "rack_unit_position": 50})
    assert bad.status_code == 422
    node = client.post("/api/v1/infrastructure/nodes", headers=op.headers, json={
        "name": "gpu-1", "rack_id": rid, "resource_type": "gpu_node", "rack_unit_position": 10,
        "cpu_cores": 32, "memory_bytes": 128 * GIB, "accelerator_info": "2x NVIDIA L4"}).json()
    wl = client.post("/api/v1/infrastructure/workloads", headers=op.headers, json={
        "name": "model-serving", "workload_type": "model_serving", "node_id": node["id"],
        "observed_state": "running",
        "resource_request": {"cpu_cores": 8, "memory_bytes": 32 * GIB, "accelerators": 1}})
    assert wl.status_code == 201
    # A manually registered workload has no telemetry, so its observed state stays unknown.
    assert wl.json()["observed_state"] == "unknown"

    detail = client.get(f"/api/v1/infrastructure/racks/{rid}", headers=auditor.headers).json()
    assert detail["node_count"] == 1 and detail["capacity"]["accelerators"] == 2
    assert detail["nodes"][0]["allocated"] == {"cpu_cores": 8, "memory_bytes": 32 * GIB,
                                               "storage_bytes": 0, "accelerators": 1}
    assert [w["name"] for w in detail["workloads"]] == ["model-serving"]

    # Tenant isolation.
    assert client.get(f"/api/v1/infrastructure/racks/{rid}",
                      headers=outsider.headers).status_code == 404
    assert client.get("/api/v1/infrastructure/racks", headers=outsider.headers).json() == \
        {"items": []}
    assert client.post("/api/v1/infrastructure/workloads", headers=outsider.headers, json={
        "name": "x", "workload_type": "api", "node_id": node["id"]}).status_code == 404

    assert client.delete(f"/api/v1/infrastructure/racks/{rid}",
                         headers=op.headers).status_code == 409  # not empty
    events = client.get("/api/v1/admin/audit-events?action=infra",
                        headers=auditor.headers).json()["items"]
    assert {e["action"] for e in events} >= {"infra.rack.create", "infra.node.create",
                                              "infra.workload.create"}


def test_seeded_simulated_inventory_is_labelled(client: TestClient, factory: Factory) -> None:
    op = factory.actor(Role.OPERATOR)
    assert cli_main(["seed-infra", "--tenant", "acme"]) == 0
    assert cli_main(["seed-infra", "--tenant", "acme"]) == 0  # idempotent
    racks = client.get("/api/v1/infrastructure/racks", headers=op.headers).json()["items"]
    assert len(racks) == 2 and {r["state_source"] for r in racks} == {"simulated"}
    workloads = client.get("/api/v1/infrastructure/workloads", headers=op.headers).json()["items"]
    assert len(workloads) == 7 and all(w["state_source"] == "simulated" for w in workloads)
    overview = client.get("/api/v1/infrastructure/overview", headers=op.headers).json()
    assert overview["racks"]["simulated"] == 2 and overview["racks"]["integration"] == 0
    assert "No hardware is discovered or controlled" in overview["note"]
