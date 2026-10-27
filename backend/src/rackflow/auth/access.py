"""Collection-level access decisions. Single source of truth for *which content* a caller sees.

Every retrieval, listing, citation and snippet path must go through these helpers.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from rackflow.auth.principal import Principal
from rackflow.auth.rbac import Permission
from rackflow.core.errors import NotFoundError
from rackflow.db.models import (
    Collection,
    CollectionPermission,
    CollectionPermissionLevel,
    CollectionVisibility,
    Role,
)

_LEVEL_RANK = {
    CollectionPermissionLevel.READ: 1,
    CollectionPermissionLevel.WRITE: 2,
    CollectionPermissionLevel.MANAGE: 3,
}


def _best(*levels: CollectionPermissionLevel | None) -> CollectionPermissionLevel | None:
    present = [lv for lv in levels if lv is not None]
    return max(present, key=_LEVEL_RANK.__getitem__) if present else None


def content_level(
    principal: Principal,
    collection: Collection,
    grant: CollectionPermissionLevel | None,
) -> CollectionPermissionLevel | None:
    """Effective content access level for one collection (None = no content access)."""
    if collection.tenant_id != principal.tenant_id:
        return None
    if not principal.can(Permission.DOCUMENT_READ_CONTENT):
        return None  # e.g. auditors: metadata only
    if principal.role == Role.ORG_ADMIN:
        return CollectionPermissionLevel.MANAGE
    implicit: CollectionPermissionLevel | None = None
    if collection.created_by == principal.user_id:
        implicit = CollectionPermissionLevel.MANAGE
    elif collection.visibility == CollectionVisibility.TENANT:
        implicit = (
            CollectionPermissionLevel.WRITE
            if principal.role == Role.ENGINEER
            else CollectionPermissionLevel.READ
        )
    return _best(implicit, grant)


def _grants(db: Session, principal: Principal) -> dict[uuid.UUID, CollectionPermissionLevel]:
    rows = db.execute(
        select(CollectionPermission.collection_id, CollectionPermission.permission).where(
            CollectionPermission.tenant_id == principal.tenant_id,
            CollectionPermission.principal_type == "user",
            CollectionPermission.principal_id == principal.user_id,
        )
    ).all()
    out: dict[uuid.UUID, CollectionPermissionLevel] = {}
    for cid, level in rows:
        out[cid] = _best(out.get(cid), level) or level
    return out


def accessible_collections(
    db: Session,
    principal: Principal,
    minimum: CollectionPermissionLevel = CollectionPermissionLevel.READ,
) -> dict[uuid.UUID, CollectionPermissionLevel]:
    """Collections whose *content* the caller may access at `minimum` level or above."""
    grants = _grants(db, principal)
    collections = db.scalars(
        select(Collection).where(Collection.tenant_id == principal.tenant_id)
    ).all()
    result: dict[uuid.UUID, CollectionPermissionLevel] = {}
    for c in collections:
        level = content_level(principal, c, grants.get(c.id))
        if level is not None and _LEVEL_RANK[level] >= _LEVEL_RANK[minimum]:
            result[c.id] = level
    return result


def visible_collection_ids(db: Session, principal: Principal) -> set[uuid.UUID]:
    """Collections whose *metadata* the caller may see (admins/auditors: whole tenant)."""
    if principal.role in (Role.ORG_ADMIN, Role.AUDITOR):
        return set(
            db.scalars(select(Collection.id).where(Collection.tenant_id == principal.tenant_id))
        )
    return set(accessible_collections(db, principal))


def require_collection(
    db: Session,
    principal: Principal,
    collection_id: uuid.UUID,
    minimum: CollectionPermissionLevel | None = CollectionPermissionLevel.READ,
) -> Collection:
    """Load a collection the caller may use. Missing, foreign and forbidden all look identical."""
    collection = db.scalar(
        select(Collection).where(
            Collection.id == collection_id, Collection.tenant_id == principal.tenant_id
        )
    )
    if collection is None:
        raise NotFoundError(code="COLLECTION_NOT_FOUND",
                            message="The requested collection could not be found.")
    if minimum is None:
        if collection.id not in visible_collection_ids(db, principal):
            raise NotFoundError(code="COLLECTION_NOT_FOUND",
                                message="The requested collection could not be found.")
        return collection
    grant = _grants(db, principal).get(collection.id)
    level = content_level(principal, collection, grant)
    if level is None or _LEVEL_RANK[level] < _LEVEL_RANK[minimum]:
        raise NotFoundError(code="COLLECTION_NOT_FOUND",
                            message="The requested collection could not be found.")
    return collection
