"""Role → permission matrix. Deny by default: a permission not listed for a role is refused.

Roles are the coarse layer; collection permissions (see `access.py`) further narrow which
document content a user can see. Navigation hiding in the UI is never a security boundary.
"""

from __future__ import annotations

import enum

from rackflow.db.models import Role


class Permission(enum.StrEnum):
    COLLECTION_READ = "collection:read"  # see collection/document metadata
    COLLECTION_CREATE = "collection:create"
    COLLECTION_MANAGE = "collection:manage"  # still requires MANAGE level on the collection
    DOCUMENT_UPLOAD = "document:upload"  # still requires WRITE level on the collection
    DOCUMENT_READ_CONTENT = "document:read_content"  # chunks, snippets, citations
    DOCUMENT_DELETE = "document:delete"
    DOCUMENT_RETRY = "document:retry"
    CHAT_USE = "chat:use"
    RETRIEVAL_INSPECT = "retrieval:inspect"
    JOB_READ = "job:read"
    JOB_MANAGE = "job:manage"  # retry / cancel any job in the tenant
    OPS_READ = "ops:read"
    MODEL_READ = "model:read"
    MODEL_MANAGE = "model:manage"
    INFRA_READ = "infra:read"
    INFRA_MANAGE = "infra:manage"
    USER_READ = "user:read"
    USER_MANAGE = "user:manage"
    AUDIT_READ = "audit:read"
    EVAL_READ = "eval:read"
    EVAL_RUN = "eval:run"
    SETTINGS_MANAGE = "settings:manage"


P = Permission

ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.ORG_ADMIN: frozenset(Permission),
    Role.OPERATOR: frozenset(
        {
            P.COLLECTION_READ,
            P.DOCUMENT_READ_CONTENT,
            P.DOCUMENT_RETRY,
            P.CHAT_USE,
            P.RETRIEVAL_INSPECT,
            P.JOB_READ,
            P.JOB_MANAGE,
            P.OPS_READ,
            P.MODEL_READ,
            P.INFRA_READ,
            P.INFRA_MANAGE,
            P.EVAL_READ,
            P.EVAL_RUN,
        }
    ),
    Role.ENGINEER: frozenset(
        {
            P.COLLECTION_READ,
            P.COLLECTION_CREATE,
            P.COLLECTION_MANAGE,
            P.DOCUMENT_UPLOAD,
            P.DOCUMENT_READ_CONTENT,
            P.DOCUMENT_DELETE,
            P.DOCUMENT_RETRY,
            P.CHAT_USE,
            P.JOB_READ,
            P.MODEL_READ,
            P.INFRA_READ,
            P.EVAL_READ,
        }
    ),
    # Read-only reviewer: status, metadata and audit — never document content.
    Role.AUDITOR: frozenset(
        {
            P.COLLECTION_READ,
            P.JOB_READ,
            P.OPS_READ,
            P.MODEL_READ,
            P.INFRA_READ,
            P.USER_READ,
            P.AUDIT_READ,
            P.EVAL_READ,
        }
    ),
}


def role_has(role: Role, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, frozenset())
