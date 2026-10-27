"""Logical infrastructure registry: racks, nodes/resources and workload placement (ADR-002).

This is software inventory, not hardware control. Every record carries `state_source`:
- `manual`      — registered by an operator (configured state; nothing is measured),
- `simulated`   — demo/test data, always labelled as such,
- `integration` — reported by a real integration. Clients cannot create `integration` records;
                  the only integration today is RackFlow's own worker heartbeat telemetry.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from rackflow.audit import record_audit
from rackflow.auth.deps import require
from rackflow.auth.principal import Principal
from rackflow.auth.rbac import Permission
from rackflow.core.errors import ConflictError, NotFoundError, ValidationFailedError
from rackflow.db.models import NodeResource, Rack, StateSource, WorkerHeartbeat, Workload
from rackflow.db.session import get_db
from rackflow.worker.main import HEARTBEAT_SECONDS

router = APIRouter(prefix="/infrastructure", tags=["infrastructure"])

ClientSource = Literal["manual", "simulated"]
Health = Literal["healthy", "degraded", "offline", "unknown"]
Environment = Literal["production", "staging", "development", "lab"]
ResourceType = Literal["server", "gpu_node", "storage", "vm", "network"]
WorkloadType = Literal["api", "worker", "vector_db", "database", "model_serving",
                       "object_storage", "other"]


# ------------------------------------------------------------------ schemas


class Capacity(BaseModel):
    cpu_cores: int = 0
    memory_bytes: int = 0
    storage_bytes: int = 0
    accelerators: int = 0


class RackIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    environment: Environment = "production"
    location_label: str | None = Field(default=None, max_length=200)
    description: str = Field(default="", max_length=2000)
    rack_units: int | None = Field(default=None, ge=1, le=60)
    state_source: ClientSource = "manual"
    status: Health = "unknown"


class RackPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    environment: Environment | None = None
    location_label: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    status: Health | None = None


class NodeIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    rack_id: uuid.UUID | None = None
    resource_type: ResourceType = "server"
    rack_unit_position: int | None = Field(default=None, ge=1, le=60)
    cpu_cores: int | None = Field(default=None, ge=0, le=4096)
    memory_bytes: int | None = Field(default=None, ge=0)
    accelerator_info: str | None = Field(default=None, max_length=200)
    storage_bytes: int | None = Field(default=None, ge=0)
    state_source: ClientSource = "manual"
    status: Health = "unknown"


class NodePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    rack_id: uuid.UUID | None = None
    rack_unit_position: int | None = Field(default=None, ge=1, le=60)
    cpu_cores: int | None = Field(default=None, ge=0, le=4096)
    memory_bytes: int | None = Field(default=None, ge=0)
    accelerator_info: str | None = Field(default=None, max_length=200)
    storage_bytes: int | None = Field(default=None, ge=0)
    status: Health | None = None


class ResourceRequest(BaseModel):
    cpu_cores: float | None = Field(default=None, ge=0)
    memory_bytes: int | None = Field(default=None, ge=0)
    accelerators: int | None = Field(default=None, ge=0)


class WorkloadIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    workload_type: WorkloadType
    node_id: uuid.UUID | None = None
    desired_state: Literal["running", "stopped"] = "running"
    observed_state: Literal["running", "stopped", "degraded", "unknown"] = "unknown"
    resource_request: ResourceRequest = Field(default_factory=ResourceRequest)
    state_source: ClientSource = "manual"


class WorkloadPatch(BaseModel):
    node_id: uuid.UUID | None = None
    desired_state: Literal["running", "stopped"] | None = None
    observed_state: Literal["running", "stopped", "degraded", "unknown"] | None = None
    resource_request: ResourceRequest | None = None


class WorkloadOut(BaseModel):
    id: uuid.UUID
    name: str
    workload_type: str
    node_id: uuid.UUID | None
    node_name: str | None
    rack_id: uuid.UUID | None
    desired_state: str
    observed_state: str
    resource_request: dict[str, Any]
    state_source: StateSource
    updated_at: datetime


class NodeOut(BaseModel):
    id: uuid.UUID
    name: str
    rack_id: uuid.UUID | None
    resource_type: str
    rack_unit_position: int | None
    cpu_cores: int | None
    memory_bytes: int | None
    accelerator_info: str | None
    storage_bytes: int | None
    state_source: StateSource
    status: str
    last_seen_at: datetime | None
    allocated: Capacity  # sum of workload resource *requests* — an estimate, not measured usage
    workload_count: int
    updated_at: datetime


class RackOut(BaseModel):
    id: uuid.UUID
    name: str
    environment: str
    location_label: str | None
    description: str
    rack_units: int | None
    state_source: StateSource
    status: str
    node_count: int
    capacity: Capacity
    updated_at: datetime


class RackDetail(RackOut):
    nodes: list[NodeOut]
    workloads: list[WorkloadOut]


class Items[T](BaseModel):
    items: list[T]


class PlatformProcess(BaseModel):
    worker_id: str
    hostname: str
    status: str
    health: Literal["healthy", "stale", "stopped"]
    last_heartbeat_at: datetime
    state_source: StateSource = StateSource.INTEGRATION


class Overview(BaseModel):
    racks: dict[str, int]
    nodes: dict[str, int]
    workloads: dict[str, int]
    platform_processes: list[PlatformProcess]
    note: str


# ------------------------------------------------------------------ helpers


def _accel_count(info: str | None) -> int:
    if not info:
        return 0
    head = info.strip().split("x", 1)[0].strip()
    return int(head) if head.isdigit() else 1


def _get(db: Session, model: Any, principal: Principal, obj_id: uuid.UUID, what: str) -> Any:
    obj = db.scalar(select(model).where(model.id == obj_id, model.tenant_id == principal.tenant_id))
    if obj is None:
        raise NotFoundError(code=f"{what.upper()}_NOT_FOUND",
                            message=f"The requested {what} could not be found.")
    return obj


def _workloads(db: Session, tenant_id: uuid.UUID, node_ids: list[uuid.UUID] | None = None,
               ) -> list[WorkloadOut]:
    stmt = (select(Workload, NodeResource.name, NodeResource.rack_id)
            .outerjoin(NodeResource, NodeResource.id == Workload.node_id)
            .where(Workload.tenant_id == tenant_id))
    if node_ids is not None:
        stmt = stmt.where(Workload.node_id.in_(node_ids))
    return [WorkloadOut(id=w.id, name=w.name, workload_type=w.workload_type, node_id=w.node_id,
                        node_name=node_name, rack_id=rack_id, desired_state=w.desired_state,
                        observed_state=w.observed_state,
                        resource_request=dict(w.resource_request or {}),
                        state_source=w.state_source, updated_at=w.updated_at)
            for w, node_name, rack_id in db.execute(stmt.order_by(Workload.name)).all()]


def _nodes(db: Session, tenant_id: uuid.UUID, rack_id: uuid.UUID | None = None,
           node_id: uuid.UUID | None = None) -> list[NodeOut]:
    stmt = select(NodeResource).where(NodeResource.tenant_id == tenant_id)
    if rack_id is not None:
        stmt = stmt.where(NodeResource.rack_id == rack_id)
    if node_id is not None:
        stmt = stmt.where(NodeResource.id == node_id)
    nodes = db.scalars(stmt.order_by(NodeResource.rack_unit_position.desc().nulls_last(),
                                     NodeResource.name)).all()
    workloads = _workloads(db, tenant_id, [n.id for n in nodes]) if nodes else []
    out: list[NodeOut] = []
    for n in nodes:
        mine = [w for w in workloads if w.node_id == n.id]
        alloc = Capacity(
            cpu_cores=int(sum(w.resource_request.get("cpu_cores") or 0 for w in mine)),
            memory_bytes=int(sum(w.resource_request.get("memory_bytes") or 0 for w in mine)),
            accelerators=int(sum(w.resource_request.get("accelerators") or 0 for w in mine)),
        )
        out.append(NodeOut(
            id=n.id, name=n.name, rack_id=n.rack_id, resource_type=n.resource_type,
            rack_unit_position=n.rack_unit_position, cpu_cores=n.cpu_cores,
            memory_bytes=n.memory_bytes, accelerator_info=n.accelerator_info,
            storage_bytes=n.storage_bytes, state_source=n.state_source, status=n.status,
            last_seen_at=n.last_seen_at, allocated=alloc, workload_count=len(mine),
            updated_at=n.updated_at,
        ))
    return out


def _rack_out(db: Session, rack: Rack) -> RackOut:
    nodes = db.scalars(select(NodeResource).where(NodeResource.rack_id == rack.id)).all()
    capacity = Capacity(
        cpu_cores=sum(n.cpu_cores or 0 for n in nodes),
        memory_bytes=sum(n.memory_bytes or 0 for n in nodes),
        storage_bytes=sum(n.storage_bytes or 0 for n in nodes),
        accelerators=sum(_accel_count(n.accelerator_info) for n in nodes),
    )
    return RackOut(id=rack.id, name=rack.name, environment=rack.environment,
                   location_label=rack.location_label, description=rack.description,
                   rack_units=rack.rack_units, state_source=rack.state_source, status=rack.status,
                   node_count=len(nodes), capacity=capacity, updated_at=rack.updated_at)


def _check_position(db: Session, principal: Principal, rack_id: uuid.UUID | None,
                    position: int | None) -> None:
    if rack_id is None:
        return
    rack = _get(db, Rack, principal, rack_id, "rack")
    if position is not None and rack.rack_units is not None and position > rack.rack_units:
        raise ValidationFailedError(code="INVALID_RACK_UNIT",
                                    message="Rack unit position exceeds the rack height.")


# ------------------------------------------------------------------- routes


@router.get("/overview", response_model=Overview)
def overview(
    principal: Principal = Depends(require(Permission.INFRA_READ)),
    db: Session = Depends(get_db),
) -> Overview:
    def by_source(model: Any) -> dict[str, int]:
        rows = db.execute(select(model.state_source, func.count()).where(
            model.tenant_id == principal.tenant_id).group_by(model.state_source)).all()
        counts = {s.value: 0 for s in StateSource}
        counts.update({src.value: n for src, n in rows})
        return counts

    now = datetime.now(UTC)
    recent = now - timedelta(hours=1)
    stale_after = timedelta(seconds=HEARTBEAT_SECONDS * 3)
    workers = db.scalars(select(WorkerHeartbeat).where(
        WorkerHeartbeat.last_heartbeat_at > recent)).all()
    return Overview(
        racks=by_source(Rack), nodes=by_source(NodeResource), workloads=by_source(Workload),
        platform_processes=[PlatformProcess(
            worker_id=w.worker_id, hostname=w.hostname, status=w.status,
            health="stopped" if w.status == "stopped"
            else "healthy" if now - w.last_heartbeat_at <= stale_after else "stale",
            last_heartbeat_at=w.last_heartbeat_at)
                            for w in workers],
        note=("Racks, nodes and workloads are logical inventory (configured or simulated). Only "
              "platform processes are integration-reported, from worker heartbeats. No hardware "
              "is discovered or controlled."),
    )


@router.get("/racks", response_model=Items[RackOut])
def list_racks(
    principal: Principal = Depends(require(Permission.INFRA_READ)),
    db: Session = Depends(get_db),
) -> Items[RackOut]:
    racks = db.scalars(select(Rack).where(Rack.tenant_id == principal.tenant_id)
                       .order_by(Rack.name)).all()
    return Items[RackOut](items=[_rack_out(db, r) for r in racks])


@router.post("/racks", response_model=RackOut, status_code=201)
def create_rack(
    body: RackIn,
    principal: Principal = Depends(require(Permission.INFRA_MANAGE)),
    db: Session = Depends(get_db),
) -> RackOut:
    if db.scalar(select(Rack.id).where(Rack.tenant_id == principal.tenant_id,
                                       Rack.name == body.name)):
        raise ConflictError(code="RACK_NAME_TAKEN", message="A rack with this name exists.")
    rack = Rack(tenant_id=principal.tenant_id, name=body.name, environment=body.environment,
                location_label=body.location_label, description=body.description,
                rack_units=body.rack_units, state_source=StateSource(body.state_source),
                status=body.status, metadata_json={})
    db.add(rack)
    db.flush()
    record_audit(db, action="infra.rack.create", resource_type="rack", resource_id=rack.id,
                 principal=principal, metadata={"state_source": body.state_source})
    db.commit()
    return _rack_out(db, rack)


@router.get("/racks/{rack_id}", response_model=RackDetail)
def get_rack(
    rack_id: uuid.UUID,
    principal: Principal = Depends(require(Permission.INFRA_READ)),
    db: Session = Depends(get_db),
) -> RackDetail:
    rack = _get(db, Rack, principal, rack_id, "rack")
    nodes = _nodes(db, principal.tenant_id, rack_id=rack.id)
    return RackDetail(**_rack_out(db, rack).model_dump(), nodes=nodes,
                      workloads=_workloads(db, principal.tenant_id, [n.id for n in nodes]))


@router.patch("/racks/{rack_id}", response_model=RackOut)
def update_rack(
    rack_id: uuid.UUID,
    body: RackPatch,
    principal: Principal = Depends(require(Permission.INFRA_MANAGE)),
    db: Session = Depends(get_db),
) -> RackOut:
    rack = _get(db, Rack, principal, rack_id, "rack")
    if rack.state_source == StateSource.INTEGRATION:
        raise ConflictError(code="INTEGRATION_MANAGED",
                            message="Integration-reported records cannot be edited manually.")
    for field in body.model_fields_set:
        setattr(rack, field, getattr(body, field))
    record_audit(db, action="infra.rack.update", resource_type="rack", resource_id=rack.id,
                 principal=principal, metadata={"fields": sorted(body.model_fields_set)})
    db.commit()
    return _rack_out(db, rack)


@router.delete("/racks/{rack_id}", status_code=204)
def delete_rack(
    rack_id: uuid.UUID,
    principal: Principal = Depends(require(Permission.INFRA_MANAGE)),
    db: Session = Depends(get_db),
) -> Response:
    rack = _get(db, Rack, principal, rack_id, "rack")
    if db.scalar(select(func.count()).select_from(NodeResource).where(
            NodeResource.rack_id == rack.id)):
        raise ConflictError(code="RACK_NOT_EMPTY", message="Move or remove the rack's nodes first.")
    db.delete(rack)
    record_audit(db, action="infra.rack.delete", resource_type="rack", resource_id=rack_id,
                 principal=principal)
    db.commit()
    return Response(status_code=204)


@router.get("/nodes", response_model=Items[NodeOut])
def list_nodes(
    rack_id: uuid.UUID | None = None,
    principal: Principal = Depends(require(Permission.INFRA_READ)),
    db: Session = Depends(get_db),
) -> Items[NodeOut]:
    return Items[NodeOut](items=_nodes(db, principal.tenant_id, rack_id=rack_id))


@router.post("/nodes", response_model=NodeOut, status_code=201)
def create_node(
    body: NodeIn,
    principal: Principal = Depends(require(Permission.INFRA_MANAGE)),
    db: Session = Depends(get_db),
) -> NodeOut:
    _check_position(db, principal, body.rack_id, body.rack_unit_position)
    node = NodeResource(tenant_id=principal.tenant_id, **body.model_dump(exclude={"state_source"}),
                        state_source=StateSource(body.state_source), metadata_json={})
    db.add(node)
    db.flush()
    record_audit(db, action="infra.node.create", resource_type="node", resource_id=node.id,
                 principal=principal, metadata={"state_source": body.state_source})
    db.commit()
    return _nodes(db, principal.tenant_id, node_id=node.id)[0]


@router.patch("/nodes/{node_id}", response_model=NodeOut)
def update_node(
    node_id: uuid.UUID,
    body: NodePatch,
    principal: Principal = Depends(require(Permission.INFRA_MANAGE)),
    db: Session = Depends(get_db),
) -> NodeOut:
    node = _get(db, NodeResource, principal, node_id, "node")
    if node.state_source == StateSource.INTEGRATION:
        raise ConflictError(code="INTEGRATION_MANAGED",
                            message="Integration-reported records cannot be edited manually.")
    rack_id = body.rack_id if "rack_id" in body.model_fields_set else node.rack_id
    position = (body.rack_unit_position if "rack_unit_position" in body.model_fields_set
                else node.rack_unit_position)
    _check_position(db, principal, rack_id, position)
    for field in body.model_fields_set:
        setattr(node, field, getattr(body, field))
    record_audit(db, action="infra.node.update", resource_type="node", resource_id=node.id,
                 principal=principal, metadata={"fields": sorted(body.model_fields_set)})
    db.commit()
    return _nodes(db, principal.tenant_id, node_id=node.id)[0]


@router.get("/workloads", response_model=Items[WorkloadOut])
def list_workloads(
    principal: Principal = Depends(require(Permission.INFRA_READ)),
    db: Session = Depends(get_db),
) -> Items[WorkloadOut]:
    return Items[WorkloadOut](items=_workloads(db, principal.tenant_id))


@router.post("/workloads", response_model=WorkloadOut, status_code=201)
def create_workload(
    body: WorkloadIn,
    principal: Principal = Depends(require(Permission.INFRA_MANAGE)),
    db: Session = Depends(get_db),
) -> WorkloadOut:
    """Registers a logical workload. It never deploys, starts or controls anything."""
    if body.node_id is not None:
        _get(db, NodeResource, principal, body.node_id, "node")
    # Without telemetry, a manually registered workload's observed state is unknown.
    observed = body.observed_state if body.state_source == "simulated" else "unknown"
    w = Workload(tenant_id=principal.tenant_id, name=body.name, workload_type=body.workload_type,
                 node_id=body.node_id, desired_state=body.desired_state, observed_state=observed,
                 resource_request=body.resource_request.model_dump(exclude_none=True),
                 resource_assignment={}, state_source=StateSource(body.state_source))
    db.add(w)
    db.flush()
    record_audit(db, action="infra.workload.create", resource_type="workload", resource_id=w.id,
                 principal=principal, metadata={"state_source": body.state_source})
    db.commit()
    return next(x for x in _workloads(db, principal.tenant_id) if x.id == w.id)


@router.patch("/workloads/{workload_id}", response_model=WorkloadOut)
def update_workload(
    workload_id: uuid.UUID,
    body: WorkloadPatch,
    principal: Principal = Depends(require(Permission.INFRA_MANAGE)),
    db: Session = Depends(get_db),
) -> WorkloadOut:
    w = _get(db, Workload, principal, workload_id, "workload")
    if w.state_source == StateSource.INTEGRATION:
        raise ConflictError(code="INTEGRATION_MANAGED",
                            message="Integration-reported records cannot be edited manually.")
    if "node_id" in body.model_fields_set and body.node_id is not None:
        _get(db, NodeResource, principal, body.node_id, "node")
    for field in body.model_fields_set:
        if field == "observed_state" and w.state_source != StateSource.SIMULATED:
            continue  # observed state needs telemetry; ignored for manual records
        value = getattr(body, field)
        if field == "resource_request" and value is not None:
            value = value.model_dump(exclude_none=True)
        setattr(w, field, value)
    record_audit(db, action="infra.workload.update", resource_type="workload", resource_id=w.id,
                 principal=principal, metadata={"fields": sorted(body.model_fields_set)})
    db.commit()
    return next(x for x in _workloads(db, principal.tenant_id) if x.id == w.id)
