#!/usr/bin/env python3
"""Back up a RackFlow install: PostgreSQL, the Qdrant collection and the object storage directory.

One run writes one directory, <output>/rackflow-backup-<UTC timestamp>/, holding:

  postgres.dump        pg_dump custom format (-Fc)
  qdrant.snapshot      Qdrant collection snapshot (absent if the collection does not exist yet)
  objects.tar.gz       the OBJECT_STORAGE_PATH directory
  manifest.json        sizes, sha256, tool/server versions, Alembic revision, row and point counts

The directory is built under a ".partial" name and renamed only when every part succeeded, so a
directory with the final name is always complete. The table counts are taken inside the same
PostgreSQL snapshot pg_dump reads (pg_export_snapshot + pg_dump --snapshot), so they describe the
dump exactly. Qdrant and the object store are read a moment later; see README.md.

Settings come from the same environment variables as the app (DATABASE_URL, VECTOR_STORE_URL,
VECTOR_STORE_API_KEY, VECTOR_COLLECTION, OBJECT_STORAGE_PATH), falling back to the repo .env the app
reads in development. Passwords and keys are never printed. pg_dump is taken from PG_BIN or PATH.

The live install is only read: the one write is the temporary Qdrant snapshot file, which is
deleted from the Qdrant server after it has been downloaded.

Usage:
  python scripts/ops/backup.py --output D:/backups [--keep 7]

Run it with the backend virtualenv's Python (it needs psycopg and httpx).
The backup holds every tenant's documents and the password and session-token hashes, so on POSIX
it runs with umask 077 and leaves the backup directory 0700 and its files 0600.
Exit codes: 0 success, 1 failure (nothing kept for this run), 2 bad arguments.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
from collections.abc import Iterator, Mapping
from contextlib import contextmanager, suppress
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, quote, unquote, urlsplit

TOOL_NAME = "rackflow-backup"
TOOL_VERSION = "1"
MANIFEST_FORMAT = 1
MANIFEST = "manifest.json"
PG_FILE = "postgres.dump"
QDRANT_FILE = "qdrant.snapshot"
STORAGE_FILE = "objects.tar.gz"
STORAGE_ROOT = "objects"  # top-level directory name inside objects.tar.gz
BACKUP_DIR_RE = re.compile(r"^rackflow-backup-\d{8}T\d{6}Z$")

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_KEYS = (
    "DATABASE_URL",
    "VECTOR_STORE_URL",
    "VECTOR_STORE_API_KEY",
    "VECTOR_COLLECTION",
    "OBJECT_STORAGE_PATH",
)
# Same defaults as rackflow.core.config.Settings.
DEFAULTS = {
    "DATABASE_URL": "postgresql+psycopg://rackflow:rackflow@127.0.0.1:5432/rackflow",
    "VECTOR_STORE_URL": "http://127.0.0.1:6333",
    "VECTOR_STORE_API_KEY": "",
    "VECTOR_COLLECTION": "rackflow_chunks",
    "OBJECT_STORAGE_PATH": str(REPO_ROOT / ".data" / "objects"),
}
CHUNK = 1024 * 1024
POSIX = os.name == "posix"
PRIVATE_UMASK = 0o077
PRIVATE_DIR_MODE = 0o700
PRIVATE_FILE_MODE = 0o600


class OpsError(RuntimeError):
    """An expected failure with a secret-free message for the operator."""


# --------------------------------------------------------------------------- configuration


def read_env_file(path: Path) -> dict[str, str]:
    """Parse KEY=VALUE lines the way the app's .env is written (no interpolation)."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export "):].strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key.upper()] = value
    return values


def load_settings(
    env: Mapping[str, str] | None = None, env_file: Path | None = None
) -> dict[str, str]:
    """Process environment first, then the env file, then the app defaults (as the app does)."""
    env = os.environ if env is None else env
    upper = {k.upper(): v for k, v in env.items()}
    file_values = read_env_file(env_file) if env_file else {}
    settings: dict[str, str] = {}
    for key in ENV_KEYS:
        if key in upper:
            settings[key] = upper[key]
        elif key in file_values:
            settings[key] = file_values[key]
        else:
            settings[key] = DEFAULTS[key]
    storage = Path(settings["OBJECT_STORAGE_PATH"])
    if not storage.is_absolute():  # the app resolves a relative path against the repo root
        storage = (REPO_ROOT / storage).resolve()
    settings["OBJECT_STORAGE_PATH"] = str(storage)
    return settings


@dataclass(frozen=True)
class PgTarget:
    host: str | None
    port: int | None
    user: str | None
    password: str | None
    dbname: str
    options: dict[str, str] = field(default_factory=dict)

    def with_db(self, dbname: str) -> PgTarget:
        return PgTarget(self.host, self.port, self.user, self.password, dbname, dict(self.options))

    def connect_kwargs(self) -> dict[str, Any]:
        kwargs: dict[str, Any] = dict(self.options)
        kwargs["dbname"] = self.dbname
        for key in ("host", "port", "user", "password"):
            value = getattr(self, key)
            if value is not None:
                kwargs[key] = value
        return kwargs

    def conninfo_without_password(self) -> str:
        """libpq keyword/value string for --dbname; the password goes in PGPASSWORD instead, so it
        never appears on a command line other users of the host can list."""
        parts = {k: v for k, v in self.connect_kwargs().items() if k != "password"}
        return " ".join(f"{k}={_conninfo_quote(str(v))}" for k, v in parts.items())

    def tool_env(self, base: Mapping[str, str] | None = None) -> dict[str, str]:
        env = dict(os.environ if base is None else base)
        env.pop("PGPASSWORD", None)
        if self.password:
            env["PGPASSWORD"] = self.password
        return env

    def describe(self) -> str:
        where = self.host or "local socket"
        return f"{where}:{self.port or 5432}/{self.dbname}"


def _conninfo_quote(value: str) -> str:
    if value and not re.search(r"[\s'\\]", value):
        return value
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def parse_database_url(url: str) -> PgTarget:
    """Accept the app's SQLAlchemy URL (postgresql+psycopg://...) or a plain libpq URL."""
    parts = urlsplit(url)
    scheme = parts.scheme.split("+", 1)[0]
    if scheme not in ("postgresql", "postgres"):
        raise OpsError("DATABASE_URL must be a postgresql:// URL")
    dbname = unquote(parts.path.lstrip("/"))
    if not dbname:
        raise OpsError("DATABASE_URL must name a database")
    try:
        port = parts.port
    except ValueError as exc:
        raise OpsError("DATABASE_URL has an invalid port") from exc
    return PgTarget(
        host=parts.hostname,
        port=port,
        user=unquote(parts.username) if parts.username else None,
        password=unquote(parts.password) if parts.password else None,
        dbname=dbname,
        options=dict(parse_qsl(parts.query)),
    )


def redact_url(url: str) -> str:
    """The URL with any password replaced, safe to print."""
    parts = urlsplit(url)
    if parts.password is None:
        return url
    user = quote(unquote(parts.username or ""), safe="")
    host = parts.hostname or ""
    if ":" in host:
        host = f"[{host}]"
    port = f":{parts.port}" if parts.port else ""
    return parts._replace(netloc=f"{user}:***@{host}{port}").geturl()


def scrub(text: str, secrets: list[str | None]) -> str:
    for secret in secrets:
        if secret:
            text = text.replace(secret, "***")
    return text


# --------------------------------------------------------------------------- tools and files


def find_pg_tool(name: str, env: Mapping[str, str] | None = None) -> str:
    env = os.environ if env is None else env
    pg_bin = env.get("PG_BIN")
    found = shutil.which(name, path=pg_bin) if pg_bin else shutil.which(name)
    if not found:
        where = f"PG_BIN ({pg_bin})" if pg_bin else "PATH"
        raise OpsError(
            f"{name} not found on {where}; install the PostgreSQL client tools or set PG_BIN"
        )
    return found


def tool_version(executable: str) -> str:
    out = subprocess.run(  # noqa: S603 - a resolved pg tool path, fixed arguments
        [executable, "--version"], capture_output=True, text=True, check=False
    )
    return out.stdout.strip()


def run_tool(args: list[str], env: dict[str, str], secrets: list[str | None]) -> None:
    # No shell; args[0] is a resolved pg tool and the rest are built by this module.
    proc = subprocess.run(args, capture_output=True, text=True, env=env, check=False)  # noqa: S603
    if proc.returncode != 0:
        detail = scrub((proc.stderr or proc.stdout or "").strip(), secrets)
        raise OpsError(f"{Path(args[0]).name} failed (exit {proc.returncode}): {detail[-2000:]}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def file_entry(path: Path) -> dict[str, Any]:
    return {"file": path.name, "size": path.stat().st_size, "sha256": sha256_file(path)}


def archive_storage(source: Path, dest: Path) -> dict[str, Any]:
    """tar.gz of the storage directory under a fixed top-level name. Symlinks are stored as links,
    never followed."""
    if not source.is_dir():
        raise OpsError(f"object storage directory not found: {source}")
    file_count = 0
    total_bytes = 0
    with tarfile.open(dest, "w:gz") as tar:
        tar.add(source, arcname=STORAGE_ROOT, recursive=False)
        for path in sorted(source.rglob("*")):
            rel = path.relative_to(source).as_posix()
            tar.add(path, arcname=f"{STORAGE_ROOT}/{rel}", recursive=False)
            if path.is_file() and not path.is_symlink():
                file_count += 1
                total_bytes += path.stat().st_size
    return {"file_count": file_count, "total_bytes": total_bytes}


def storage_stats(root: Path) -> dict[str, int]:
    files = [p for p in root.rglob("*") if p.is_file() and not p.is_symlink()]
    return {"file_count": len(files), "total_bytes": sum(p.stat().st_size for p in files)}


# --------------------------------------------------------------------------- Qdrant


def _seg(value: str) -> str:
    """One URL path segment: a collection or snapshot name can never add path components."""
    return quote(value, safe="")


class Qdrant:
    def __init__(self, url: str, api_key: str | None, timeout: float = 600.0) -> None:
        import httpx

        headers = {"api-key": api_key} if api_key else {}
        self.url = url.rstrip("/")
        self.http = httpx.Client(base_url=self.url, headers=headers, timeout=timeout)

    def close(self) -> None:
        self.http.close()

    def _check(self, response: Any, what: str) -> Any:
        if response.status_code >= 400:
            detail = response.text[:500]
            raise OpsError(f"Qdrant {what} failed: HTTP {response.status_code} {detail}")
        return response.json().get("result") if response.content else None

    def version(self) -> str:
        response = self.http.get("/")  # the root answers {"title", "version"}, not {"result"}
        if response.status_code >= 400:
            raise OpsError(f"Qdrant is not reachable: HTTP {response.status_code}")
        return str(response.json().get("version", ""))

    def collection_exists(self, name: str) -> bool:
        result = self._check(self.http.get(f"/collections/{_seg(name)}/exists"), "exists check")
        return bool(result and result.get("exists"))

    def collection_info(self, name: str) -> dict[str, Any]:
        return self._check(self.http.get(f"/collections/{_seg(name)}"), f"collection info {name}")

    def count(self, name: str) -> int:
        result = self._check(
            self.http.post(f"/collections/{_seg(name)}/points/count", json={"exact": True}),
            f"point count {name}",
        )
        return int(result["count"])

    def create_snapshot(self, name: str) -> dict[str, Any]:
        return self._check(
            self.http.post(f"/collections/{_seg(name)}/snapshots", params={"wait": "true"}),
            f"snapshot of {name}",
        )

    def download_snapshot(self, name: str, snapshot: str, dest: Path) -> None:
        path = f"/collections/{_seg(name)}/snapshots/{_seg(snapshot)}"
        with self.http.stream("GET", path) as response:
            if response.status_code >= 400:
                response.read()
                self._check(response, "snapshot download")
            with dest.open("wb") as fh:
                for block in response.iter_bytes(CHUNK):
                    fh.write(block)

    def delete_snapshot(self, name: str, snapshot: str) -> None:
        self._check(
            self.http.delete(f"/collections/{_seg(name)}/snapshots/{_seg(snapshot)}",
                             params={"wait": "true"}),
            "snapshot delete",
        )

    def upload_snapshot(self, name: str, path: Path, sha256: str) -> None:
        with path.open("rb") as fh:
            response = self.http.post(
                f"/collections/{_seg(name)}/snapshots/upload",
                params={"priority": "snapshot", "wait": "true", "checksum": sha256},
                files={"snapshot": (path.name, fh, "application/octet-stream")},
            )
        self._check(response, f"snapshot restore into {name}")


def vector_params(info: dict[str, Any]) -> dict[str, Any]:
    vectors = (info.get("config") or {}).get("params", {}).get("vectors") or {}
    if "size" in vectors:
        return {"size": vectors.get("size"), "distance": vectors.get("distance")}
    return {"named": sorted(vectors)} if isinstance(vectors, dict) else {}


# --------------------------------------------------------------------------- PostgreSQL


def public_table_counts(cur: Any) -> dict[str, int]:
    from psycopg import sql

    cur.execute(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
    )
    tables = [row[0] for row in cur.fetchall()]
    counts: dict[str, int] = {}
    for table in tables:
        cur.execute(sql.SQL("SELECT count(*) FROM public.{}").format(sql.Identifier(table)))
        counts[table] = int(cur.fetchone()[0])
    return counts


def alembic_revision(cur: Any) -> str | None:
    cur.execute("SELECT to_regclass('public.alembic_version') IS NOT NULL")
    if not cur.fetchone()[0]:
        return None
    cur.execute(
        "SELECT string_agg(version_num, ',' ORDER BY version_num) FROM public.alembic_version"
    )
    return cur.fetchone()[0]


@contextmanager
def exported_snapshot(target: PgTarget) -> Iterator[tuple[Any, str]]:
    """A read-only REPEATABLE READ transaction kept open while pg_dump reads its snapshot."""
    import psycopg

    kwargs = {"application_name": "rackflow-backup", **target.connect_kwargs()}
    with psycopg.connect(**kwargs) as conn:
        conn.read_only = True
        conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        with conn.cursor() as cur:
            cur.execute("SELECT pg_export_snapshot()")
            row = cur.fetchone()
            if row is None:
                raise OpsError("pg_export_snapshot returned nothing")
            yield cur, str(row[0])
        conn.rollback()


def backup_postgres(target: PgTarget, workdir: Path, pg_dump: str) -> dict[str, Any]:
    dump = workdir / PG_FILE
    with exported_snapshot(target) as (cur, snapshot_id):
        cur.execute("SHOW server_version")
        server_version = cur.fetchone()[0]
        revision = alembic_revision(cur)
        counts = public_table_counts(cur)
        run_tool(
            [pg_dump, "--format=custom", f"--snapshot={snapshot_id}", f"--file={dump}",
             "--no-password", f"--dbname={target.conninfo_without_password()}"],
            target.tool_env(),
            [target.password],
        )
    entry = file_entry(dump)
    entry.update({
        "server_version": server_version,
        "alembic_revision": revision,
        "table_counts": counts,
        "chunk_count": counts.get("chunks"),
    })
    return entry


# --------------------------------------------------------------------------- backup


def restrict_umask() -> None:
    """Make every file this process and its children (pg_dump) create owner-only. POSIX only;
    on Windows the backup inherits the ACL of the --output directory."""
    if POSIX:
        os.umask(PRIVATE_UMASK)


def make_private(directory: Path) -> None:
    """chmod a backup directory and its subdirectories to 0700 and its files to 0600, so the
    result is owner-only whatever umask the caller had. No-op off POSIX."""
    if not POSIX:
        return
    os.chmod(directory, PRIVATE_DIR_MODE)
    for child in directory.rglob("*"):
        if child.is_symlink():
            continue
        os.chmod(child, PRIVATE_DIR_MODE if child.is_dir() else PRIVATE_FILE_MODE)


def utc_stamp(now: dt.datetime | None = None) -> str:
    now = now or dt.datetime.now(dt.UTC)
    return now.strftime("%Y%m%dT%H%M%SZ")


def app_version() -> str | None:
    init = REPO_ROOT / "backend" / "src" / "rackflow" / "__init__.py"
    try:
        match = re.search(r'^__version__\s*=\s*"([^"]+)"', init.read_text(encoding="utf-8"), re.M)
    except OSError:
        return None
    return match.group(1) if match else None


def is_tool_backup(path: Path) -> bool:
    """True only for a complete directory this tool made: right name and our manifest marker."""
    if not path.is_dir() or path.is_symlink() or not BACKUP_DIR_RE.match(path.name):
        return False
    try:
        manifest = json.loads((path / MANIFEST).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return isinstance(manifest, dict) and manifest.get("tool") == TOOL_NAME


def apply_retention(output: Path, keep: int) -> list[Path]:
    """Delete this tool's backups beyond the newest `keep`. Anything else in the directory is left
    alone, including directories with a matching name but no manifest of ours."""
    if keep < 1:
        raise OpsError("--keep must be at least 1")
    ours = sorted((p for p in output.iterdir() if is_tool_backup(p)), key=lambda p: p.name)
    doomed = ours[:-keep] if len(ours) > keep else []
    for path in doomed:
        shutil.rmtree(path)
    return doomed


def run_backup(settings: Mapping[str, str], output: Path, *, now: dt.datetime | None = None,
               log: Any = print) -> Path:
    target = parse_database_url(settings["DATABASE_URL"])
    collection = settings["VECTOR_COLLECTION"]
    storage = Path(settings["OBJECT_STORAGE_PATH"])
    pg_dump = find_pg_tool("pg_dump")
    if not storage.is_dir():
        raise OpsError(f"object storage directory not found: {storage}")

    output.mkdir(mode=PRIVATE_DIR_MODE, parents=True, exist_ok=True)  # mode applies if created
    name = f"rackflow-backup-{utc_stamp(now)}"
    final = output / name
    if final.exists():
        raise OpsError(f"{final} already exists; wait a second and run again")
    partial = output / f".{name}.partial"
    if partial.exists():
        shutil.rmtree(partial)
    partial.mkdir(mode=PRIVATE_DIR_MODE)
    make_private(partial)  # pg_dump, the snapshot download and tarfile all write in here

    log(f"database   {target.describe()}")
    log(f"qdrant     {redact_url(settings['VECTOR_STORE_URL'])} collection {collection}")
    log(f"storage    {storage}")
    qdrant = Qdrant(settings["VECTOR_STORE_URL"], settings.get("VECTOR_STORE_API_KEY") or None)
    try:
        log("postgres: pg_dump ...")
        pg = backup_postgres(target, partial, pg_dump)
        log(f"postgres: {pg['size']} bytes, {sum(pg['table_counts'].values())} rows, "
            f"revision {pg['alembic_revision']}")

        qdrant_version = qdrant.version()
        if qdrant.collection_exists(collection):
            log("qdrant: snapshot ...")
            q = backup_qdrant(qdrant, collection, partial)
            log(f"qdrant: {q['size']} bytes, {q['point_count']} points")
        else:
            log(f"qdrant: collection {collection} does not exist; nothing to snapshot")
            q = {"present": False, "collection": collection, "point_count": 0}

        log("storage: archiving ...")
        stats = archive_storage(storage, partial / STORAGE_FILE)
        obj = file_entry(partial / STORAGE_FILE)
        obj.update(stats)
        log(f"storage: {obj['size']} bytes, {stats['file_count']} files")

        manifest = {
            "tool": TOOL_NAME,
            "format": MANIFEST_FORMAT,
            "name": name,
            "created_at": (now or dt.datetime.now(dt.UTC)).isoformat(),
            "versions": {
                "tool": TOOL_VERSION,
                "rackflow": app_version(),
                "pg_dump": tool_version(pg_dump),
                "postgres_server": pg["server_version"],
                "qdrant": qdrant_version,
                "python": platform.python_version(),
            },
            "alembic_revision": pg["alembic_revision"],
            "counts": {"chunks": pg["chunk_count"], "qdrant_points": q["point_count"],
                       "object_files": stats["file_count"]},
            "source": {
                "database": target.describe(),
                "vector_store_url": redact_url(settings["VECTOR_STORE_URL"]),
                "collection": collection,
                "object_storage_path": str(storage),
            },
            "postgres": pg,
            "qdrant": q,
            "object_storage": obj,
        }
        (partial / MANIFEST).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        make_private(partial)
        os.replace(partial, final)
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise
    finally:
        qdrant.close()
    return final


def backup_qdrant(qdrant: Qdrant, collection: str, workdir: Path) -> dict[str, Any]:
    info = qdrant.collection_info(collection)
    points_before = qdrant.count(collection)
    snap = qdrant.create_snapshot(collection)
    dest = workdir / QDRANT_FILE
    try:
        qdrant.download_snapshot(collection, snap["name"], dest)
    finally:
        try:
            qdrant.delete_snapshot(collection, snap["name"])
        except OpsError as exc:  # the backup is still good; the operator should clean up
            print(f"warning: could not delete server snapshot {snap['name']}: {exc}",
                  file=sys.stderr)
    entry = file_entry(dest)
    server_sum = snap.get("checksum")
    if server_sum and server_sum != entry["sha256"]:
        raise OpsError("downloaded Qdrant snapshot does not match the server's checksum")
    points_after = qdrant.count(collection)
    entry.update({
        "present": True,
        "collection": collection,
        "point_count": points_after,
        "vectors": vector_params(info),
    })
    if points_after != points_before:
        entry["note"] = f"point count changed during snapshot ({points_before} -> {points_after})"
    return entry


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Back up RackFlow PostgreSQL, Qdrant and object storage.")
    parser.add_argument("--output", required=True, type=Path,
                        help="directory that holds the timestamped backup directories")
    parser.add_argument("--keep", type=int, default=None,
                        help="after a successful backup, keep only the newest N backups "
                             "made by this tool")
    parser.add_argument("--env-file", type=Path, default=REPO_ROOT / ".env",
                        help="fallback for settings missing from the environment "
                             "(default: repo .env)")
    args = parser.parse_args(argv)
    if args.keep is not None and args.keep < 1:
        parser.error("--keep must be at least 1")
    restrict_umask()
    settings: dict[str, str] = {}
    try:
        settings = load_settings(env_file=args.env_file)
        final = run_backup(settings, args.output.resolve())
        print(f"backup complete: {final}")
        if args.keep is not None:
            for path in apply_retention(args.output.resolve(), args.keep):
                print(f"retention: deleted {path}")
    except OpsError as exc:
        print(f"backup failed: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001 - last-resort message without a traceback full of URLs
        print(f"backup failed: {type(exc).__name__}: {scrub(str(exc), secret_values(settings))}",
              file=sys.stderr)
        return 1
    return 0


def secret_values(settings: Mapping[str, str]) -> list[str | None]:
    """The strings that must never reach output: the database password and the Qdrant key."""
    secrets: list[str | None] = [settings.get("VECTOR_STORE_API_KEY")]
    with suppress(OpsError):
        secrets.append(parse_database_url(settings.get("DATABASE_URL", "")).password)
    return secrets


if __name__ == "__main__":
    sys.exit(main())
