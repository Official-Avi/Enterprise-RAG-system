"""Unit tests for scripts/ops/backup.py and scripts/ops/restore.py.

No PostgreSQL, Qdrant or pg tools are needed: the parts that talk to them are replaced by fakes.
The real round trip (backup of a live stack, restore into a new database, collection and directory,
count comparison) is the restore drill in scripts/ops/README.md.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import stat
import sys
import tarfile
from pathlib import Path
from typing import Any

import pytest

OPS_DIR = Path(__file__).resolve().parents[2] / "scripts" / "ops"
sys.path.insert(0, str(OPS_DIR))

import backup  # noqa: E402
import restore  # noqa: E402

SECRET = "s3cr3t-p@ss/word"
DB_URL = "postgresql+psycopg://rackflow:s3cr3t-p%40ss%2Fword@db.internal:6543/rackflow?sslmode=require"


# --------------------------------------------------------------------------- settings and URLs


def test_parse_database_url_decodes_and_keeps_options() -> None:
    target = backup.parse_database_url(DB_URL)
    assert (target.host, target.port, target.user, target.dbname) == (
        "db.internal", 6543, "rackflow", "rackflow")
    assert target.password == SECRET
    assert target.options == {"sslmode": "require"}
    assert target.with_db("other").dbname == "other"
    assert target.with_db("other").password == SECRET


def test_conninfo_and_tool_env_keep_password_off_the_command_line() -> None:
    target = backup.parse_database_url(DB_URL)
    conninfo = target.conninfo_without_password()
    assert SECRET not in conninfo and "password" not in conninfo
    assert "dbname=rackflow" in conninfo and "sslmode=require" in conninfo
    env = target.tool_env({"PGPASSWORD": "inherited", "PATH": "x"})
    assert env["PGPASSWORD"] == SECRET and env["PATH"] == "x"
    no_pw = backup.parse_database_url("postgresql://u@h/db").tool_env({"PGPASSWORD": "inherited"})
    assert "PGPASSWORD" not in no_pw  # never a stale password from the caller's shell


def test_conninfo_quotes_values_with_spaces() -> None:
    target = backup.PgTarget("h", 5432, "u", None, "my db", {"options": "-c x=1"})
    assert "dbname='my db'" in target.conninfo_without_password()
    assert "options='-c x=1'" in target.conninfo_without_password()


@pytest.mark.parametrize("url", ["mysql://u:p@h/db", "postgresql://u:p@h/"])
def test_parse_database_url_rejects_bad_urls(url: str) -> None:
    with pytest.raises(backup.OpsError) as exc:
        backup.parse_database_url(url)
    assert "p@" not in str(exc.value)


def test_redact_url_hides_password() -> None:
    redacted = backup.redact_url(DB_URL)
    assert SECRET not in redacted and "s3cr3t" not in redacted
    assert "rackflow:***@db.internal:6543" in redacted
    assert backup.redact_url("http://qdrant:6333") == "http://qdrant:6333"


def test_load_settings_precedence(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "# comment\nVECTOR_COLLECTION='from_file'\nDATABASE_URL=postgresql://f@h/filedb\n"
        "export OBJECT_STORAGE_PATH=relative/objects\n",
        encoding="utf-8",
    )
    settings = backup.load_settings({"database_url": "postgresql://e@h/envdb"}, env_file)
    assert settings["DATABASE_URL"] == "postgresql://e@h/envdb"  # environment wins, any case
    assert settings["VECTOR_COLLECTION"] == "from_file"
    assert settings["VECTOR_STORE_URL"] == backup.DEFAULTS["VECTOR_STORE_URL"]
    # A relative path resolves against the repo root, as rackflow.core.config does.
    expected = (backup.REPO_ROOT / "relative/objects").resolve()
    assert Path(settings["OBJECT_STORAGE_PATH"]) == expected


def test_run_tool_scrubs_secret_from_tool_errors() -> None:
    code = f"import sys; sys.stderr.write('auth failed for {SECRET}'); sys.exit(2)"
    with pytest.raises(backup.OpsError) as exc:
        backup.run_tool([sys.executable, "-c", code], {}, [SECRET])
    assert SECRET not in str(exc.value) and "***" in str(exc.value) and "exit 2" in str(exc.value)


def test_find_pg_tool_reports_where_it_looked(tmp_path: Path) -> None:
    with pytest.raises(backup.OpsError, match="PG_BIN"):
        backup.find_pg_tool("pg_dump", {"PG_BIN": str(tmp_path)})


def test_backup_main_never_prints_the_password(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DATABASE_URL", DB_URL)
    monkeypatch.setenv("PG_BIN", str(tmp_path / "no-tools"))
    monkeypatch.setenv("OBJECT_STORAGE_PATH", str(tmp_path))
    argv = ["--output", str(tmp_path / "out"), "--env-file", str(tmp_path / "none")]
    assert backup.main(argv) == 1
    out = capsys.readouterr()
    assert "pg_dump not found" in out.err
    assert SECRET not in out.out + out.err and "s3cr3t" not in out.out + out.err


# --------------------------------------------------------------------------- retention


def _fake_backup(root: Path, name: str, tool: str = backup.TOOL_NAME) -> Path:
    path = root / name
    path.mkdir()
    (path / backup.MANIFEST).write_text(json.dumps({"tool": tool}), encoding="utf-8")
    return path


def test_retention_deletes_only_this_tools_older_backups(tmp_path: Path) -> None:
    old = _fake_backup(tmp_path, "rackflow-backup-20260101T000000Z")
    mid = _fake_backup(tmp_path, "rackflow-backup-20260201T000000Z")
    new = _fake_backup(tmp_path, "rackflow-backup-20260301T000000Z")
    foreign = _fake_backup(tmp_path, "rackflow-backup-20250101T000000Z", tool="something-else")
    no_manifest = tmp_path / "rackflow-backup-20240101T000000Z"
    no_manifest.mkdir()
    other_name = _fake_backup(tmp_path, "my-backup-20200101T000000Z")
    partial = tmp_path / ".rackflow-backup-20190101T000000Z.partial"
    partial.mkdir()
    stray_file = tmp_path / "rackflow-backup-20180101T000000Z"
    stray_file.write_text("x", encoding="utf-8")

    deleted = backup.apply_retention(tmp_path, keep=2)

    assert deleted == [old]
    assert not old.exists()
    for kept in (mid, new, foreign, no_manifest, other_name, partial, stray_file):
        assert kept.exists(), kept
    assert backup.apply_retention(tmp_path, keep=2) == []


def test_retention_rejects_zero(tmp_path: Path) -> None:
    with pytest.raises(backup.OpsError):
        backup.apply_retention(tmp_path, keep=0)
    with pytest.raises(SystemExit):
        backup.main(["--output", str(tmp_path), "--keep", "0"])


# --------------------------------------------------------------------------- object storage


def _make_storage(root: Path) -> None:
    (root / "tenant-a" / "doc").mkdir(parents=True)
    (root / "tenant-a" / "doc" / "v1.pdf").write_bytes(b"%PDF-1.7 abc")
    (root / "tenant-b").mkdir()
    (root / "tenant-b" / "notes.txt").write_bytes(b"hello")
    (root / "empty-dir").mkdir()


def test_storage_archive_round_trip(tmp_path: Path) -> None:
    source = tmp_path / "objects"
    _make_storage(source)
    archive = tmp_path / backup.STORAGE_FILE
    stats = backup.archive_storage(source, archive)
    assert stats == {"file_count": 2, "total_bytes": len(b"%PDF-1.7 abc") + len(b"hello")}

    target = tmp_path / "restored"
    restore.restore_storage(archive, target)
    assert (target / "tenant-a" / "doc" / "v1.pdf").read_bytes() == b"%PDF-1.7 abc"
    assert (target / "tenant-b" / "notes.txt").read_bytes() == b"hello"
    assert (target / "empty-dir").is_dir()
    assert backup.storage_stats(target) == stats


def _tar_with(path: Path, name: str) -> None:
    with tarfile.open(path, "w:gz") as tar:
        info = tarfile.TarInfo(name)
        info.size = 4
        tar.addfile(info, io.BytesIO(b"evil"))


@pytest.mark.parametrize("member", ["elsewhere/file", "objects/../../escape.txt", "/abs/file"])
def test_restore_storage_refuses_members_outside_the_target(tmp_path: Path, member: str) -> None:
    archive = tmp_path / "bad.tar.gz"
    _tar_with(archive, member)
    target = tmp_path / "target"
    with pytest.raises((restore.OpsError, tarfile.FilterError)):
        restore.restore_storage(archive, target)
    assert not (tmp_path / "escape.txt").exists()
    assert not any(p.is_file() for p in target.rglob("*"))


def test_archive_storage_requires_the_directory(tmp_path: Path) -> None:
    with pytest.raises(backup.OpsError, match="not found"):
        backup.archive_storage(tmp_path / "missing", tmp_path / "x.tar.gz")


# --------------------------------------------------------------------------- backup with fakes


class FakeQdrant:
    """Stands in for backup.Qdrant: one collection with `points` points and a snapshot file."""

    def __init__(self, url: str = "", api_key: str | None = None, *, points: int = 3,
                 exists: bool = True, payload: bytes = b"qdrant-snapshot-bytes") -> None:
        self.points = points
        self.exists = exists
        self.payload = payload
        self.deleted: list[str] = []
        self.uploaded: list[tuple[str, str]] = []
        self.closed = False

    def version(self) -> str:
        return "1.20.0"

    def collection_exists(self, name: str) -> bool:
        return self.exists

    def collection_info(self, name: str) -> dict[str, Any]:
        return {"config": {"params": {"vectors": {"size": 384, "distance": "Cosine"}}}}

    def count(self, name: str) -> int:
        return self.points

    def create_snapshot(self, name: str) -> dict[str, Any]:
        import hashlib

        return {"name": "snap-1", "checksum": hashlib.sha256(self.payload).hexdigest()}

    def download_snapshot(self, name: str, snapshot: str, dest: Path) -> None:
        dest.write_bytes(self.payload)

    def delete_snapshot(self, name: str, snapshot: str) -> None:
        self.deleted.append(snapshot)

    def upload_snapshot(self, name: str, path: Path, sha256: str) -> None:
        self.uploaded.append((name, sha256))

    def close(self) -> None:
        self.closed = True


def _fake_pg(target: Any, workdir: Path, pg_dump: str) -> dict[str, Any]:
    dump = workdir / backup.PG_FILE
    dump.write_bytes(b"PGDMP fake")
    entry = backup.file_entry(dump)
    entry.update({"server_version": "18.6", "alembic_revision": "0001",
                  "table_counts": {"chunks": 3, "users": 2}, "chunk_count": 3})
    return entry


@pytest.fixture
def fake_backend(monkeypatch: pytest.MonkeyPatch) -> FakeQdrant:
    fake = FakeQdrant()
    monkeypatch.setattr(backup, "find_pg_tool", lambda name, env=None: "pg_dump")
    monkeypatch.setattr(backup, "tool_version", lambda exe: "pg_dump (PostgreSQL) 18.6")
    monkeypatch.setattr(backup, "backup_postgres", _fake_pg)
    monkeypatch.setattr(backup, "Qdrant", lambda url, key: fake)
    return fake


def _settings(tmp_path: Path) -> dict[str, str]:
    storage = tmp_path / "objects"
    if not storage.exists():
        _make_storage(storage)
    return {"DATABASE_URL": DB_URL, "VECTOR_STORE_URL": "http://qdrant:6333",
            "VECTOR_STORE_API_KEY": "qdrant-key", "VECTOR_COLLECTION": "rackflow_chunks",
            "OBJECT_STORAGE_PATH": str(storage)}


def test_run_backup_writes_a_verifiable_manifest(tmp_path: Path, fake_backend: FakeQdrant) -> None:
    out = tmp_path / "out"
    final = backup.run_backup(_settings(tmp_path), out, log=lambda *_: None)

    assert backup.BACKUP_DIR_RE.match(final.name) and backup.is_tool_backup(final)
    assert [p.name for p in out.iterdir()] == [final.name]  # no .partial left behind
    manifest = json.loads((final / backup.MANIFEST).read_text(encoding="utf-8"))
    assert manifest["alembic_revision"] == "0001"
    assert manifest["counts"] == {"chunks": 3, "qdrant_points": 3, "object_files": 2}
    assert manifest["versions"]["qdrant"] == "1.20.0"
    assert manifest["versions"]["postgres_server"] == "18.6"
    assert manifest["qdrant"]["vectors"] == {"size": 384, "distance": "Cosine"}
    text = json.dumps(manifest)
    assert SECRET not in text and "s3cr3t" not in text and "qdrant-key" not in text
    assert fake_backend.deleted == ["snap-1"] and fake_backend.closed
    assert restore.verify_checksums(final, restore.load_manifest(final)) == [
        backup.PG_FILE, backup.QDRANT_FILE, backup.STORAGE_FILE]


def test_run_backup_without_collection(tmp_path: Path, fake_backend: FakeQdrant) -> None:
    fake_backend.exists = False
    final = backup.run_backup(_settings(tmp_path), tmp_path / "out", log=lambda *_: None)
    manifest = json.loads((final / backup.MANIFEST).read_text(encoding="utf-8"))
    assert manifest["qdrant"] == {"present": False, "collection": "rackflow_chunks",
                                  "point_count": 0}
    assert not (final / backup.QDRANT_FILE).exists()
    assert restore.verify_checksums(final, manifest) == [backup.PG_FILE, backup.STORAGE_FILE]


def test_run_backup_failure_leaves_nothing(tmp_path: Path, fake_backend: FakeQdrant,
                                           monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_: Any) -> dict[str, Any]:
        raise backup.OpsError("archive failed")

    monkeypatch.setattr(backup, "archive_storage", boom)
    out = tmp_path / "out"
    with pytest.raises(backup.OpsError):
        backup.run_backup(_settings(tmp_path), out, log=lambda *_: None)
    assert list(out.iterdir()) == []
    assert fake_backend.closed


def test_run_backup_rejects_snapshot_checksum_mismatch(tmp_path: Path, fake_backend: FakeQdrant,
                                                       monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(fake_backend, "create_snapshot",
                        lambda name: {"name": "snap-1", "checksum": "0" * 64})
    out = tmp_path / "out"
    with pytest.raises(backup.OpsError, match="checksum"):
        backup.run_backup(_settings(tmp_path), out, log=lambda *_: None)
    assert list(out.iterdir()) == []
    assert fake_backend.deleted == ["snap-1"]  # the server-side snapshot is still cleaned up


# --------------------------------------------------------------------------- restore checks


@pytest.fixture
def made_backup(tmp_path: Path, fake_backend: FakeQdrant) -> Path:
    return backup.run_backup(_settings(tmp_path), tmp_path / "out", log=lambda *_: None)


def test_verify_checksums_detects_tampering(made_backup: Path) -> None:
    manifest = restore.load_manifest(made_backup)
    dump = made_backup / backup.PG_FILE
    dump.write_bytes(b"PGDMP fakx")  # same size, different content
    with pytest.raises(restore.OpsError, match="postgres.dump: sha256"):
        restore.verify_checksums(made_backup, manifest)
    dump.unlink()
    with pytest.raises(restore.OpsError, match="postgres.dump: missing"):
        restore.verify_checksums(made_backup, manifest)


@pytest.mark.parametrize("name", ["../postgres.dump", "sub/postgres.dump", "..", ""])
def test_manifest_file_names_cannot_leave_the_backup(made_backup: Path, name: str) -> None:
    manifest = restore.load_manifest(made_backup)
    manifest["postgres"]["file"] = name
    with pytest.raises(restore.OpsError, match="invalid file name"):
        restore.verify_checksums(made_backup, manifest)


def test_load_manifest_rejects_foreign_or_unknown_format(tmp_path: Path) -> None:
    (tmp_path / backup.MANIFEST).write_text(json.dumps({"tool": "other"}), encoding="utf-8")
    with pytest.raises(restore.OpsError, match="not written by"):
        restore.load_manifest(tmp_path)
    (tmp_path / backup.MANIFEST).write_text(
        json.dumps({"tool": backup.TOOL_NAME, "format": 99}), encoding="utf-8")
    with pytest.raises(restore.OpsError, match="unsupported"):
        restore.load_manifest(tmp_path)


def _args(made_backup: Path, **kw: Any) -> argparse.Namespace:
    base = {"backup_dir": made_backup, "target_db": None, "target_collection": None,
            "target_storage": None, "force": False}
    base.update(kw)
    return argparse.Namespace(**base)


def test_plan_refuses_every_non_empty_target_at_once(made_backup: Path, tmp_path: Path,
                                                     monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(restore, "database_state", lambda server, name: (True, True))
    storage = tmp_path / "busy"
    storage.mkdir()
    (storage / "f").write_text("x", encoding="utf-8")
    args = _args(made_backup, target_db="drill", target_collection="drill", target_storage=storage)
    manifest = restore.load_manifest(made_backup)
    with pytest.raises(restore.OpsError) as exc:
        restore.plan_restore(args, _settings(tmp_path), manifest, FakeQdrant(points=5))
    message = str(exc.value)
    assert "database drill is not empty" in message
    assert "collection drill is not empty" in message
    assert "is not empty (use --force to extract over it)" in message

    args.force = True
    plan = restore.plan_restore(args, _settings(tmp_path), manifest, FakeQdrant(points=5))
    assert plan.db_nonempty and plan.collection == "drill" and plan.storage == storage


def test_plan_accepts_empty_targets(made_backup: Path, tmp_path: Path,
                                    monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(restore, "database_state", lambda server, name: (True, False))
    empty = tmp_path / "empty"
    empty.mkdir()
    args = _args(made_backup, target_db="drill", target_collection="drill", target_storage=empty)
    plan = restore.plan_restore(args, _settings(tmp_path), restore.load_manifest(made_backup),
                                FakeQdrant(points=0))
    assert plan.db is not None and plan.db.dbname == "drill" and not plan.db_nonempty
    assert plan.db.host == "db.internal"  # the server comes from DATABASE_URL


def test_run_restore_checks_checksums_before_touching_targets(
    made_backup: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (made_backup / backup.STORAGE_FILE).write_bytes(b"corrupt")

    def must_not_run(*_: Any, **__: Any) -> None:
        raise AssertionError("a target was inspected or written before checksums passed")

    monkeypatch.setattr(restore, "plan_restore", must_not_run)
    monkeypatch.setattr(restore, "restore_storage", must_not_run)
    args = _args(made_backup, target_storage=tmp_path / "t")
    with pytest.raises(restore.OpsError, match="checksum verification failed"):
        restore.run_restore(args, _settings(tmp_path))
    assert not (tmp_path / "t").exists()


def test_run_restore_storage_only_and_count_report(
    made_backup: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    target = tmp_path / "drill-objects"
    assert restore.run_restore(_args(made_backup, target_storage=target), _settings(tmp_path)) == 0
    out = capsys.readouterr().out
    assert "checksums  ok" in out and "every count matches" in out
    assert (target / "tenant-b" / "notes.txt").read_bytes() == b"hello"

    # Without --force the now non-empty directory is refused.
    with pytest.raises(restore.OpsError, match="not empty"):
        restore.run_restore(_args(made_backup, target_storage=target), _settings(tmp_path))
    # With --force an extra local file makes the counts differ, and the exit code says so.
    (target / "extra.bin").write_bytes(b"12345")
    code = restore.run_restore(_args(made_backup, target_storage=target, force=True),
                               _settings(tmp_path))
    assert code == restore.EXIT_MISMATCH
    assert "MISMATCH" in capsys.readouterr().out


def test_run_restore_qdrant_upload_uses_manifest_checksum(
    made_backup: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeQdrant(points=0)
    monkeypatch.setattr(restore, "Qdrant", lambda url, key: fake)
    manifest = restore.load_manifest(made_backup)
    fake_points = manifest["qdrant"]["point_count"]

    def upload(name: str, path: Path, sha256: str) -> None:
        fake.uploaded.append((name, sha256))
        fake.points = fake_points

    monkeypatch.setattr(fake, "upload_snapshot", upload)
    code = restore.run_restore(_args(made_backup, target_collection="drill"), _settings(tmp_path))
    assert code == 0
    assert fake.uploaded == [("drill", manifest["qdrant"]["sha256"])] and fake.closed


def test_compare_tables_flags_missing_and_extra() -> None:
    rows = restore.compare_tables({"a": 1, "b": 2}, {"a": 1, "c": 0})
    by_item = {r.item: r for r in rows}
    assert by_item["a"].ok
    assert not by_item["b"].ok and by_item["b"].actual == "missing"
    assert not by_item["c"].ok and by_item["c"].expected == "absent"


@pytest.mark.parametrize("argv", [
    ["dir"],  # no target at all
    ["dir", "--target-db", "drop table"],
    ["dir", "--target-db", "x;y"],
    ["dir", "--target-collection", "../x"],
])
def test_restore_args_validation(argv: list[str]) -> None:
    with pytest.raises(SystemExit):
        restore.parse_args(argv)


# --------------------------------------------------------------------------- permissions


def test_backup_main_sets_owner_only_umask(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []
    monkeypatch.setattr(backup, "POSIX", True)
    monkeypatch.setattr(backup.os, "umask", lambda mask: calls.append(mask) or 0o022)
    monkeypatch.setattr(backup, "load_settings", lambda env_file: (_ for _ in ()).throw(
        backup.OpsError("stop here")))
    assert backup.main(["--output", "unused"]) == 1
    assert calls == [0o077]


def test_make_private_chmods_the_whole_backup(tmp_path: Path,
                                              monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "sub").mkdir()
    (tmp_path / "manifest.json").write_text("{}", encoding="utf-8")
    (tmp_path / "sub" / "f").write_bytes(b"x")
    calls: dict[str, int] = {}
    monkeypatch.setattr(backup, "POSIX", True)
    monkeypatch.setattr(backup.os, "chmod",
                        lambda path, mode: calls.__setitem__(Path(path).relative_to(tmp_path)
                                                             .as_posix(), mode))
    backup.make_private(tmp_path)
    assert calls == {".": 0o700, "sub": 0o700, "manifest.json": 0o600, "sub/f": 0o600}


@pytest.mark.skipif(os.name != "posix", reason="POSIX file modes")
def test_run_backup_output_is_owner_only(tmp_path: Path, fake_backend: FakeQdrant) -> None:
    old = os.umask(0o022)  # a typical permissive umask; the backup must not rely on it
    try:
        out = tmp_path / "out"
        final = backup.run_backup(_settings(tmp_path), out, log=lambda *_: None)
    finally:
        os.umask(old)
    assert stat.S_IMODE(out.stat().st_mode) == 0o700
    assert stat.S_IMODE(final.stat().st_mode) == 0o700
    for name in (backup.MANIFEST, backup.PG_FILE, backup.QDRANT_FILE, backup.STORAGE_FILE):
        assert stat.S_IMODE((final / name).stat().st_mode) == 0o600, name


def test_chown_tree_changes_every_path_without_following_links(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_storage(tmp_path / "t")
    seen: list[tuple[str, int, int]] = []
    monkeypatch.setattr(restore.os, "lchown",
                        lambda p, u, g: seen.append((Path(p).relative_to(tmp_path / "t")
                                                     .as_posix(), u, g)), raising=False)
    count = restore.chown_tree(tmp_path / "t", 10001, 10002)
    expected = {".", *(p.relative_to(tmp_path / "t").as_posix()
                       for p in (tmp_path / "t").rglob("*"))}
    assert {s[0] for s in seen} == expected and count == len(seen) == len(expected)
    assert {(u, g) for _, u, g in seen} == {(10001, 10002)}


def test_run_restore_chowns_the_storage_target(
    made_backup: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[tuple[Path, int, int]] = []
    monkeypatch.setattr(restore, "chown_tree",
                        lambda target, uid, gid: calls.append((target, uid, gid)) or 1)
    target = tmp_path / "volume"
    args = _args(made_backup, target_storage=target, chown=(10001, 10001))
    assert restore.run_restore(args, _settings(tmp_path)) == 0
    assert calls == [(target, 10001, 10001)]


def test_restore_chown_args(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(restore.os, "lchown", lambda *a: None, raising=False)
    args = restore.parse_args(["d", "--target-storage", str(tmp_path), "--chown", "10001:10001"])
    assert args.chown == (10001, 10001)
    for argv in (["d", "--target-storage", str(tmp_path), "--chown", "app:app"],
                 ["d", "--target-storage", str(tmp_path), "--chown", "10001"],
                 ["d", "--target-db", "x", "--chown", "10001:10001"]):
        with pytest.raises(SystemExit):
            restore.parse_args(argv)
    monkeypatch.delattr(restore.os, "lchown")
    with pytest.raises(SystemExit):
        restore.parse_args(["d", "--target-storage", str(tmp_path), "--chown", "1:1"])
