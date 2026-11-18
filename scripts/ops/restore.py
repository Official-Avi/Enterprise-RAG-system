#!/usr/bin/env python3
"""Restore a backup made by backup.py into targets named on the command line.

  python scripts/ops/restore.py BACKUP_DIR \\
      [--target-db NAME] [--target-collection NAME] [--target-storage DIR [--chown UID:GID]]
      [--force]

Only the components given a target are restored; at least one is required. The server addresses
come from the same environment variables as the app (DATABASE_URL names the PostgreSQL server and
login, VECTOR_STORE_URL / VECTOR_STORE_API_KEY the Qdrant server); the database, collection and
directory names come only from the command line, so a restore never writes to the live install by
default.

Order of work, so that a refusal never leaves a half-restored install:
  1. read manifest.json and verify the size and sha256 of every file it lists;
  2. check every chosen target: a non-empty database, collection or directory is refused unless
     --force is given;
  3. restore: pg_restore into the database (created if missing), Qdrant snapshot upload into the
     collection (created by the upload), tar extraction into the directory (then, with --chown,
     ownership of the whole directory to UID:GID, since extracted files belong to the caller);
  4. print the backup-vs-restored comparison of table rows, Qdrant points and object files.

--force on a non-empty target: pg_restore --clean --if-exists drops and recreates the objects in the
dump (objects not in the dump stay); the Qdrant collection is replaced by the snapshot; files from
the archive overwrite files of the same name in the directory (other files stay).

Exit codes: 0 restored and every count matches, 1 failure or refusal, 2 bad arguments,
3 restored but a count differs from the manifest.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tarfile
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import backup as common  # noqa: E402  (sibling module; also importable from the tests)
from backup import (  # noqa: E402
    MANIFEST,
    MANIFEST_FORMAT,
    STORAGE_ROOT,
    TOOL_NAME,
    OpsError,
    PgTarget,
    Qdrant,
)

DB_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
COLLECTION_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,254}$")
CHOWN_RE = re.compile(r"^(\d{1,10}):(\d{1,10})$")
EXIT_MISMATCH = 3


# --------------------------------------------------------------------------- manifest


def load_manifest(backup_dir: Path) -> dict[str, Any]:
    path = backup_dir / MANIFEST
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise OpsError(f"cannot read {path}: {exc.strerror}") from exc
    except ValueError as exc:
        raise OpsError(f"{path} is not valid JSON") from exc
    if not isinstance(manifest, dict) or manifest.get("tool") != TOOL_NAME:
        raise OpsError(f"{path} was not written by {TOOL_NAME}")
    if manifest.get("format") != MANIFEST_FORMAT:
        raise OpsError(f"unsupported manifest format {manifest.get('format')!r}")
    return manifest


def manifest_files(manifest: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Every file the manifest lists. A name that is not a plain file name is refused, so an edited
    manifest cannot point the restore at a file outside the backup directory."""
    entries = []
    for section in ("postgres", "qdrant", "object_storage"):
        entry = manifest.get(section) or {}
        if section == "qdrant" and not entry.get("present", False):
            continue
        name = entry.get("file")
        if not isinstance(name, str) or not name or Path(name).name != name or name in (".", ".."):
            raise OpsError(f"manifest section {section!r} has an invalid file name")
        if not isinstance(entry.get("sha256"), str) or not isinstance(entry.get("size"), int):
            raise OpsError(f"manifest section {section!r} lacks a size or sha256")
        entries.append(entry)
    return entries


def verify_checksums(backup_dir: Path, manifest: Mapping[str, Any]) -> list[str]:
    """Raise unless every listed file exists with the recorded size and sha256."""
    problems = []
    checked = []
    for entry in manifest_files(manifest):
        path = backup_dir / entry["file"]
        if not path.is_file():
            problems.append(f"{entry['file']}: missing")
            continue
        size = path.stat().st_size
        if size != entry["size"]:
            problems.append(f"{entry['file']}: size {size} != manifest {entry['size']}")
            continue
        if common.sha256_file(path) != entry["sha256"]:
            problems.append(f"{entry['file']}: sha256 does not match the manifest")
            continue
        checked.append(entry["file"])
    if problems:
        raise OpsError("checksum verification failed, nothing was restored: " + "; ".join(problems))
    return checked


# --------------------------------------------------------------------------- targets


@dataclass
class Plan:
    db: PgTarget | None
    db_exists: bool
    db_nonempty: bool
    collection: str | None
    collection_exists: bool
    storage: Path | None


def database_state(server: PgTarget, name: str) -> tuple[bool, bool]:
    """(exists, has user objects) for database `name` on the server DATABASE_URL points at."""
    import psycopg

    with psycopg.connect(**server.connect_kwargs(), autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone()
    if not exists:
        return False, False
    with psycopg.connect(**server.with_db(name).connect_kwargs(), autocommit=True) as conn:
        row = conn.execute(
            "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') "
            "AND n.nspname NOT LIKE 'pg\\_toast%' AND c.relkind IN ('r','p','v','m','S','f')"
        ).fetchone()
    return True, bool(row and row[0])


def directory_nonempty(path: Path) -> bool:
    if not path.exists():
        return False
    if not path.is_dir():
        raise OpsError(f"--target-storage {path} exists and is not a directory")
    return any(path.iterdir())


def plan_restore(args: argparse.Namespace, settings: Mapping[str, str],
                 manifest: Mapping[str, Any], qdrant: Qdrant | None) -> Plan:
    """Check every target before anything is written. Raises OpsError with all refusals at once.
    `qdrant` is None when no collection is to be restored."""
    refusals: list[str] = []
    db = None
    db_exists = db_nonempty = False
    if args.target_db:
        server = common.parse_database_url(settings["DATABASE_URL"])
        db = server.with_db(args.target_db)
        db_exists, db_nonempty = database_state(server, args.target_db)
        if db_nonempty and not args.force:
            refusals.append(f"database {args.target_db} is not empty "
                            "(use --force to restore over it)")
    collection = None
    collection_exists = False
    if args.target_collection and qdrant is None:
        print(f"note: the backup has no Qdrant snapshot; {args.target_collection} is left alone")
    elif args.target_collection and qdrant is not None:
        collection = args.target_collection
        collection_exists = qdrant.collection_exists(collection)
        if collection_exists and qdrant.count(collection) > 0 and not args.force:
            refusals.append(f"collection {collection} is not empty (use --force to replace it)")
    if args.target_storage and directory_nonempty(args.target_storage) and not args.force:
        refusals.append(f"directory {args.target_storage} is not empty "
                        "(use --force to extract over it)")
    if refusals:
        raise OpsError("refusing to restore, nothing was changed: " + "; ".join(refusals))
    return Plan(db, db_exists, db_nonempty, collection, collection_exists, args.target_storage)


# --------------------------------------------------------------------------- restore steps


def restore_postgres(target: PgTarget, plan: Plan, server: PgTarget, dump: Path,
                     pg_restore: str) -> None:
    import psycopg
    from psycopg import sql

    if not plan.db_exists:
        with psycopg.connect(**server.connect_kwargs(), autocommit=True) as conn:
            conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(target.dbname)))
        print(f"postgres: created database {target.dbname}")
    args = [pg_restore, "--no-password", "--no-owner", "--no-acl", "--exit-on-error",
            "--single-transaction", f"--dbname={target.conninfo_without_password()}"]
    if plan.db_nonempty:
        args += ["--clean", "--if-exists"]
    args.append(str(dump))
    common.run_tool(args, target.tool_env(), [target.password])


def _storage_members(tar: tarfile.TarFile) -> Iterator[tarfile.TarInfo]:
    """Members of objects.tar.gz re-rooted from objects/... to the target directory. A member
    outside objects/ is refused; tarfile's "data" filter then rejects absolute paths, '..', device
    files and links that leave the directory."""
    prefix = STORAGE_ROOT + "/"
    for member in tar:
        if member.name == STORAGE_ROOT:
            continue
        if not member.name.startswith(prefix):
            raise OpsError(f"archive member outside {STORAGE_ROOT}/: {member.name!r}")
        member.name = member.name[len(prefix):]
        if member.islnk() and member.linkname.startswith(prefix):
            member.linkname = member.linkname[len(prefix):]
        yield member


def restore_storage(archive: Path, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as tar:
        tar.extractall(target, members=_storage_members(tar), filter="data")


def chown_tree(target: Path, uid: int, gid: int) -> int:
    """Give the target directory and everything under it to uid:gid (symlinks themselves, never
    what they point at). The "data" filter drops the archive's owners, so extracted files belong
    to the user running the restore (root when writing into a Docker volume); the app (UID 10001
    in the images) must own them to add uploads. Returns the number of paths changed."""
    lchown = getattr(os, "lchown", None)
    if lchown is None:
        raise OpsError("--chown is only supported on POSIX systems")
    lchown(target, uid, gid)
    changed = 1
    for root, dirs, files in os.walk(target):  # os.walk does not follow directory symlinks
        for name in (*dirs, *files):
            lchown(os.path.join(root, name), uid, gid)
            changed += 1
    return changed


# --------------------------------------------------------------------------- comparison


@dataclass
class Row:
    component: str
    item: str
    expected: Any
    actual: Any

    @property
    def ok(self) -> bool:
        return self.expected == self.actual


def compare_tables(expected: Mapping[str, int], actual: Mapping[str, int]) -> list[Row]:
    rows = [Row("postgres", table, count, actual.get(table, "missing"))
            for table, count in sorted(expected.items())]
    rows += [Row("postgres", table, "absent", actual[table])
             for table in sorted(set(actual) - set(expected))]
    return rows


def print_rows(rows: list[Row]) -> None:
    widths = [max(len(str(v)) for v in col) for col in zip(
        ("component", "item", "backup", "restored"),
        *[(r.component, r.item, r.expected, r.actual) for r in rows], strict=True)]
    header = ("component", "item", "backup", "restored", "")
    print("  ".join(str(h).ljust(w) for h, w in zip(header, [*widths, 2], strict=True)).rstrip())
    for r in rows:
        cells = (r.component, r.item, r.expected, r.actual, "ok" if r.ok else "MISMATCH")
        print("  ".join(str(c).ljust(w) for c, w in zip(cells, [*widths, 2], strict=True)).rstrip())


def collect_comparison(plan: Plan, manifest: Mapping[str, Any],
                       qdrant: Qdrant | None) -> list[Row]:
    rows: list[Row] = []
    if plan.db is not None:
        import psycopg

        pg = manifest["postgres"]
        with (psycopg.connect(**plan.db.connect_kwargs(), autocommit=True) as conn,
              conn.cursor() as cur):
            counts = common.public_table_counts(cur)
            revision = common.alembic_revision(cur)
        rows.append(Row("postgres", "alembic_revision", pg.get("alembic_revision"), revision))
        rows += compare_tables(pg.get("table_counts") or {}, counts)
    if plan.collection and qdrant is not None:
        rows.append(Row("qdrant", f"points ({plan.collection})",
                        manifest["qdrant"].get("point_count"), qdrant.count(plan.collection)))
    if plan.storage is not None:
        obj = manifest["object_storage"]
        stats = common.storage_stats(plan.storage)
        rows.append(Row("storage", "files", obj.get("file_count"), stats["file_count"]))
        rows.append(Row("storage", "bytes", obj.get("total_bytes"), stats["total_bytes"]))
    return rows


# --------------------------------------------------------------------------- main


def run_restore(args: argparse.Namespace, settings: Mapping[str, str]) -> int:
    backup_dir: Path = args.backup_dir.resolve()
    manifest = load_manifest(backup_dir)
    print(f"backup     {manifest.get('name')} created {manifest.get('created_at')}, "
          f"revision {manifest.get('alembic_revision')}")
    checked = verify_checksums(backup_dir, manifest)
    print(f"checksums  ok ({', '.join(checked)})")

    pg_restore = common.find_pg_tool("pg_restore") if args.target_db else None
    want_qdrant = bool(args.target_collection and (manifest.get("qdrant") or {}).get("present"))
    qdrant = Qdrant(settings["VECTOR_STORE_URL"], settings.get("VECTOR_STORE_API_KEY") or None) \
        if want_qdrant else None
    try:
        plan = plan_restore(args, settings, manifest, qdrant)
        if plan.db is not None and pg_restore is not None:
            server = common.parse_database_url(settings["DATABASE_URL"])
            print(f"postgres: restoring into {plan.db.describe()} ...")
            restore_postgres(plan.db, plan, server, backup_dir / manifest["postgres"]["file"],
                             pg_restore)
        if qdrant is not None and plan.collection:
            q = manifest["qdrant"]
            print(f"qdrant: restoring into collection {plan.collection} on "
                  f"{common.redact_url(settings['VECTOR_STORE_URL'])} ...")
            qdrant.upload_snapshot(plan.collection, backup_dir / q["file"], q["sha256"])
        if plan.storage is not None:
            print(f"storage: extracting into {plan.storage} ...")
            restore_storage(backup_dir / manifest["object_storage"]["file"], plan.storage)
            owner = getattr(args, "chown", None)
            if owner is not None:
                count = chown_tree(plan.storage, *owner)
                print(f"storage: {count} paths now owned by {owner[0]}:{owner[1]}")
        rows = collect_comparison(plan, manifest, qdrant)
    finally:
        if qdrant is not None:
            qdrant.close()
    print()
    print_rows(rows)
    mismatches = [r for r in rows if not r.ok]
    if mismatches:
        print(f"\nrestore finished with {len(mismatches)} count mismatch(es)", file=sys.stderr)
        return EXIT_MISMATCH
    print("\nrestore complete: every count matches the manifest")
    return 0


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Restore a RackFlow backup into named targets.")
    parser.add_argument("backup_dir", type=Path, help="a rackflow-backup-<timestamp> directory")
    parser.add_argument("--target-db", help="database to restore into on DATABASE_URL's server")
    parser.add_argument("--target-collection", help="Qdrant collection to restore into")
    parser.add_argument("--target-storage", type=Path, help="directory to extract the objects into")
    parser.add_argument("--force", action="store_true", help="restore over non-empty targets")
    parser.add_argument("--chown", metavar="UID:GID",
                        help="after extracting, give --target-storage and everything in it to "
                             "UID:GID (POSIX, usually needs root; the images run as 10001:10001)")
    parser.add_argument("--env-file", type=Path, default=common.REPO_ROOT / ".env",
                        help="fallback for settings missing from the environment "
                             "(default: repo .env)")
    args = parser.parse_args(argv)
    if not (args.target_db or args.target_collection or args.target_storage):
        parser.error("name at least one of --target-db, --target-collection, --target-storage")
    if args.target_db and not DB_NAME_RE.match(args.target_db):
        parser.error("--target-db must be a plain identifier (letters, digits, underscore)")
    if args.target_collection and not COLLECTION_RE.match(args.target_collection):
        parser.error("--target-collection may use letters, digits, '_', '-' and '.'")
    if args.chown is not None:
        match = CHOWN_RE.match(args.chown)
        if not match:
            parser.error("--chown must be numeric UID:GID, e.g. 10001:10001")
        if args.target_storage is None:
            parser.error("--chown needs --target-storage")
        if not hasattr(os, "lchown"):
            parser.error("--chown is only supported on POSIX systems")
        args.chown = (int(match[1]), int(match[2]))
    if args.target_storage is not None:
        args.target_storage = args.target_storage.resolve()
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    settings: dict[str, str] = {}
    try:
        settings = common.load_settings(env_file=args.env_file)
        return run_restore(args, settings)
    except OpsError as exc:
        print(f"restore failed: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001 - last-resort message, scrubbed of secrets
        secret = common.scrub(str(exc), common.secret_values(settings))
        print(f"restore failed: {type(exc).__name__}: {secret}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
