from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from rackflow.audit import record_audit
from rackflow.auth.access import accessible_collections, require_collection, visible_collection_ids
from rackflow.auth.deps import require
from rackflow.auth.principal import Principal
from rackflow.auth.rbac import Permission
from rackflow.core.errors import ConflictError
from rackflow.db.models import (
    Collection,
    CollectionPermissionLevel,
    CollectionVisibility,
    Document,
    DocumentStatus,
)
from rackflow.db.session import get_db

router = APIRouter(prefix="/collections", tags=["collections"])


class CollectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    visibility: CollectionVisibility = CollectionVisibility.TENANT


class CollectionPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    visibility: CollectionVisibility | None = None


class CollectionOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    visibility: CollectionVisibility
    access_level: CollectionPermissionLevel | None  # None = metadata only
    document_count: int
    created_at: datetime
    updated_at: datetime


def _out(c: Collection, level: CollectionPermissionLevel | None, count: int) -> CollectionOut:
    return CollectionOut(
        id=c.id, name=c.name, description=c.description, visibility=c.visibility,
        access_level=level, document_count=count, created_at=c.created_at,
        updated_at=c.updated_at,
    )


def _doc_counts(db: Session, tenant_id: uuid.UUID, ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not ids:
        return {}
    rows = db.execute(
        select(Document.collection_id, func.count())
        .where(
            Document.tenant_id == tenant_id,
            Document.collection_id.in_(ids),
            Document.status != DocumentStatus.DELETED,
        )
        .group_by(Document.collection_id)
    ).all()
    return {cid: n for cid, n in rows}


@router.get("", response_model=list[CollectionOut])
def list_collections(
    limit: int = Query(default=100, ge=1, le=500),
    principal: Principal = Depends(require(Permission.COLLECTION_READ)),
    db: Session = Depends(get_db),
) -> list[CollectionOut]:
    visible = visible_collection_ids(db, principal)
    levels = accessible_collections(db, principal)
    if not visible:
        return []
    rows = db.scalars(
        select(Collection)
        .where(Collection.tenant_id == principal.tenant_id, Collection.id.in_(visible))
        .order_by(Collection.name)
        .limit(limit)
    ).all()
    counts = _doc_counts(db, principal.tenant_id, [c.id for c in rows])
    return [_out(c, levels.get(c.id), counts.get(c.id, 0)) for c in rows]


@router.post("", response_model=CollectionOut, status_code=201)
def create_collection(
    body: CollectionIn,
    principal: Principal = Depends(require(Permission.COLLECTION_CREATE)),
    db: Session = Depends(get_db),
) -> CollectionOut:
    exists = db.scalar(
        select(Collection.id).where(
            Collection.tenant_id == principal.tenant_id, Collection.name == body.name.strip()
        )
    )
    if exists:
        raise ConflictError(code="COLLECTION_NAME_TAKEN",
                            message="A collection with this name already exists.")
    c = Collection(
        tenant_id=principal.tenant_id, name=body.name.strip(), description=body.description,
        visibility=body.visibility, created_by=principal.user_id,
    )
    db.add(c)
    db.flush()
    record_audit(db, action="collection.create", resource_type="collection", resource_id=c.id,
                 principal=principal, metadata={"visibility": c.visibility.value})
    db.commit()
    return _out(c, CollectionPermissionLevel.MANAGE, 0)


@router.get("/{collection_id}", response_model=CollectionOut)
def get_collection(
    collection_id: uuid.UUID,
    principal: Principal = Depends(require(Permission.COLLECTION_READ)),
    db: Session = Depends(get_db),
) -> CollectionOut:
    c = require_collection(db, principal, collection_id, minimum=None)
    level = accessible_collections(db, principal).get(c.id)
    return _out(c, level, _doc_counts(db, principal.tenant_id, [c.id]).get(c.id, 0))


@router.patch("/{collection_id}", response_model=CollectionOut)
def update_collection(
    collection_id: uuid.UUID,
    body: CollectionPatch,
    principal: Principal = Depends(require(Permission.COLLECTION_MANAGE)),
    db: Session = Depends(get_db),
) -> CollectionOut:
    c = require_collection(db, principal, collection_id, minimum=CollectionPermissionLevel.MANAGE)
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] is not None:
        name = changes["name"].strip()
        clash = db.scalar(
            select(Collection.id).where(
                Collection.tenant_id == principal.tenant_id,
                Collection.name == name,
                Collection.id != c.id,
            )
        )
        if clash:
            raise ConflictError(code="COLLECTION_NAME_TAKEN",
                                message="A collection with this name already exists.")
        c.name = name
    if changes.get("description") is not None:
        c.description = changes["description"]
    if changes.get("visibility") is not None:
        c.visibility = changes["visibility"]
    record_audit(db, action="collection.update", resource_type="collection", resource_id=c.id,
                 principal=principal, metadata={"fields": sorted(changes)})
    db.commit()
    return _out(c, CollectionPermissionLevel.MANAGE,
                _doc_counts(db, principal.tenant_id, [c.id]).get(c.id, 0))


@router.delete("/{collection_id}", status_code=204)
def delete_collection(
    collection_id: uuid.UUID,
    principal: Principal = Depends(require(Permission.COLLECTION_MANAGE)),
    db: Session = Depends(get_db),
) -> Response:
    c = require_collection(db, principal, collection_id, minimum=CollectionPermissionLevel.MANAGE)
    if _doc_counts(db, principal.tenant_id, [c.id]).get(c.id, 0):
        # Cascading deletion of indexed documents is done per document (async cleanup jobs).
        raise ConflictError(code="COLLECTION_NOT_EMPTY",
                            message="Delete the collection's documents first.")
    db.delete(c)
    record_audit(db, action="collection.delete", resource_type="collection", resource_id=c.id,
                 principal=principal)
    db.commit()
    return Response(status_code=204)
