# Backup and restore

`backup.py` and `restore.py` back up and restore the three stores of a RackFlow install:

| Store | How | File in the backup |
| --- | --- | --- |
| PostgreSQL (all app data, the job queue, Alembic revision) | `pg_dump --format=custom` | `postgres.dump` |
| Qdrant collection (`VECTOR_COLLECTION`) | Qdrant snapshot API, downloaded, then deleted on the server | `qdrant.snapshot` |
| Object storage (`OBJECT_STORAGE_PATH`, the uploaded originals) | tar.gz | `objects.tar.gz` |

Each run writes one directory, `rackflow-backup-<UTC yyyymmddThhmmssZ>/`, with a `manifest.json` that
records each file's size and sha256, the tool, `pg_dump`, PostgreSQL server, Qdrant, RackFlow and Python
versions, the Alembic revision, the row count of every table, the chunk count, the Qdrant point count and
the object file count.

## Requirements

- The backend virtualenv's Python (the scripts use `psycopg` and `httpx`):
  `backend/.venv/Scripts/python.exe` on Windows, `backend/.venv/bin/python` on Linux.
- PostgreSQL client tools no older than the server (`pg_dump`, `pg_restore`), on `PATH` or in the
  directory named by `PG_BIN`.
- Network access to PostgreSQL and Qdrant, and read access to the object storage directory.

## Settings

The scripts read the same environment variables as the app, and fall back to the repo `.env` (or
`--env-file`) for any that are not set, then to the app's defaults:

`DATABASE_URL`, `VECTOR_STORE_URL`, `VECTOR_STORE_API_KEY`, `VECTOR_COLLECTION`, `OBJECT_STORAGE_PATH`.

Passwords and keys are never printed or written to the manifest. The database password is passed to
`pg_dump`/`pg_restore` in `PGPASSWORD`, never on the command line, and is scrubbed from tool errors.

## Back up

```sh
PG_BIN=/usr/lib/postgresql/18/bin \
  backend/.venv/bin/python scripts/ops/backup.py --output /srv/backups/rackflow --keep 14
```

- The live install is only read. The one write is a temporary snapshot file on the Qdrant server, which
  is deleted once downloaded (a warning is printed if that delete fails).
- The directory is built as `.rackflow-backup-<ts>.partial` and renamed when everything has succeeded;
  a failed run removes it. A directory with the final name is always complete.
- `--keep N` runs after a successful backup and deletes the oldest backups beyond the newest N. It only
  deletes directories named `rackflow-backup-<timestamp>` that contain a manifest written by this tool;
  anything else in the output directory is left alone.
- Exit code 0 on success, 1 on failure, 2 on bad arguments.

Consistency: the table counts are taken inside the same PostgreSQL snapshot that `pg_dump` reads
(`pg_export_snapshot` + `pg_dump --snapshot`), so they describe the dump exactly. The Qdrant snapshot
and the object archive are taken a few seconds later. If documents are being ingested or deleted during
the backup, the three can differ by those documents. For an exact set, run the backup while no
ingestion jobs are running (stop the workers, or pick a quiet time). The manifest notes when the Qdrant
point count changed during the snapshot. If restored vectors turn out to be short, `python -m
rackflow.cli reindex --tenant <slug>` re-queues ingestion of that tenant's documents from the restored
originals, and the workers rebuild the vectors.

Backups contain everything in the database, including password hashes and session-token hashes, and
every tenant's documents. On Linux/macOS `backup.py` runs with umask 077 (so `pg_dump` and the other
writers create owner-only files), creates a new `--output` directory as 0700, and leaves each backup
directory 0700 and its files 0600. An `--output` directory that already exists keeps its mode, so make
it 0700 yourself. On Windows the files inherit the ACL of `--output`; keep it on a folder only operators
can read. Store backups encrypted and copy them off the host.

Size: a Qdrant snapshot includes the collection's preallocated segment and WAL files, so it can be far
larger than the vectors themselves (about 660 MB for a 9-point collection on a local Windows Qdrant
1.20).

### With Docker Compose

`docker-compose.yml` publishes PostgreSQL on `127.0.0.1:5432` and Qdrant on `127.0.0.1:6333`, so run the
scripts on the Docker host. The production overlay (`deploy/compose.prod.yml`) publishes neither; add
loopback-only ports with a third file kept on the host, for example `compose.backup.yml`:

```yaml
services:
  postgres: { ports: ["127.0.0.1:5432:5432"] }
  qdrant: { ports: ["127.0.0.1:6333:6333"] }
```

and start the stack with `-f docker-compose.yml -f deploy/compose.prod.yml -f compose.backup.yml`. (Not
tested here: this machine has no Docker.) Then:

```sh
export DATABASE_URL="postgresql://rackflow:$POSTGRES_PASSWORD@127.0.0.1:5432/rackflow"
export VECTOR_STORE_URL=http://127.0.0.1:6333
export OBJECT_STORAGE_PATH="$(docker volume inspect -f '{{ .Mountpoint }}' rackflow_objects)"
python scripts/ops/backup.py --output /srv/backups/rackflow --keep 14
```

Reading the volume's mount point needs root. Alternatively copy the objects out first
(`docker compose cp api:/data/objects ./objects-copy`) and point `OBJECT_STORAGE_PATH` at the copy.

### Scheduling

Linux cron, nightly at 02:30 (the environment file must be readable only by the backup user):

```cron
30 2 * * * cd /opt/rackflow && set -a && . /etc/rackflow/backup.env && set +a && backend/.venv/bin/python scripts/ops/backup.py --output /srv/backups/rackflow --keep 14 >> /var/log/rackflow-backup.log 2>&1
```

On Windows use Task Scheduler with the same command line. Alert on a non-zero exit code.

## Restore

```sh
python scripts/ops/restore.py /srv/backups/rackflow/rackflow-backup-20261107T164904Z \
    --target-db rackflow_restored \
    --target-collection rackflow_restored \
    --target-storage /srv/rackflow/objects-restored
```

- Targets are named only on the command line; nothing defaults to the live database or collection.
  `DATABASE_URL` picks the PostgreSQL server and login (its database name is used only to connect and
  create the target), `VECTOR_STORE_URL`/`VECTOR_STORE_API_KEY` pick the Qdrant server.
- Only the components given a target are restored, so `--target-storage` alone restores only the files.
- Steps, in order:
  1. Every file in the manifest is checked against its size and sha256. Any difference stops the
     restore before any target is touched.
  2. Every target is checked. A database with any tables, a collection with any points, or a non-empty
     directory is refused unless `--force`, and all refusals are reported together. Nothing is changed.
  3. PostgreSQL: the database is created if missing, then `pg_restore --no-owner --no-acl
     --single-transaction --exit-on-error`. Qdrant: the snapshot is uploaded with its sha256 (Qdrant
     verifies it again) and creates or replaces the collection. Storage: the archive is extracted with
     Python's `data` filter, so paths outside the target, absolute paths and device files are refused.
     The filter also drops the archive's owners: extracted files belong to the user running the
     restore. `--chown UID:GID` (POSIX only, needs `--target-storage`) then gives the target directory
     and everything in it to that owner; use `--chown 10001:10001` for the Docker images.
  4. A table of backup vs restored counts is printed: the Alembic revision, every table's rows, the
     Qdrant points and the object files and bytes.
- Exit code 0 when every count matches, 3 when the restore ran but a count differs, 1 on failure or
  refusal, 2 on bad arguments.

`--force` on a non-empty target: PostgreSQL gets `pg_restore --clean --if-exists` (objects in the dump
are dropped and recreated; objects not in the dump stay), the Qdrant collection is replaced by the
snapshot, and archive files overwrite files of the same name (other files stay, and then show up as a
count mismatch).

### Disaster recovery

1. Stop the API and workers.
2. Restore into new names (as above), check the comparison table, then point the app at them:
   `DATABASE_URL` (database name), `VECTOR_COLLECTION` and `OBJECT_STORAGE_PATH`. Or restore into the
   original names with `--force`. Pointing the app at new names only works where you control those
   variables (a host install, or plain `docker-compose.yml`); under the production overlay use the
   Compose steps below.
3. Restore all three from the same backup: Qdrant points carry chunk IDs from PostgreSQL, and documents
   point at files in object storage.
4. Run `alembic upgrade head` if the app is newer than the backup's Alembic revision, then start the
   API and workers and check `/health/ready`.
5. Sessions in the backup are restored too. Revoke them if the incident involved credentials.

#### With Docker Compose (production overlay)

`deploy/compose.prod.yml` fixes `DATABASE_URL` to the database `rackflow`, and the image fixes
`OBJECT_STORAGE_PATH=/data/objects` (the `rackflow_objects` volume), so restore over the original
names. The API and worker run as UID/GID 10001 and must own the restored files, or new uploads into a
restored tenant fail with a permission error. Not tested here (no Docker on this machine).

```sh
C="docker compose -f docker-compose.yml -f deploy/compose.prod.yml -f compose.backup.yml --profile prod"
$C stop api worker
# Server and login only: the restore connects to "postgres" and writes the database named by --target-db.
export DATABASE_URL="postgresql://rackflow:$POSTGRES_PASSWORD@127.0.0.1:5432/postgres"
export VECTOR_STORE_URL=http://127.0.0.1:6333
OBJECTS="$(sudo docker volume inspect -f '{{ .Mountpoint }}' rackflow_objects)"
# Writing into the volume needs root; --chown hands the files back to the app user.
sudo --preserve-env=DATABASE_URL,VECTOR_STORE_URL,VECTOR_STORE_API_KEY \
  backend/.venv/bin/python scripts/ops/restore.py /srv/backups/rackflow/rackflow-backup-<ts> \
    --target-db rackflow --target-collection "${VECTOR_COLLECTION:-rackflow_chunks}" \
    --target-storage "$OBJECTS" --chown 10001:10001 --force
$C run --rm migrate          # only if the app is newer than the backup's Alembic revision
$C start api worker
```

`compose.backup.yml` is the loopback-ports file from [With Docker Compose](#with-docker-compose).
`--force` keeps database objects and files that are not in the backup; for an exact copy, first drop
the database (`$C exec postgres psql -U rackflow -d postgres -c 'DROP DATABASE rackflow WITH (FORCE)'`;
the restore recreates it) and empty the volume, then restore without `--force` for the database and
storage. If you cannot write to the mount point, restore the storage into a staging directory as
yourself and copy it in with the right owner:

```sh
python scripts/ops/restore.py <backup> --target-storage ./objects-staging
$C run --rm --no-deps --user 0 -v "$PWD/objects-staging:/restore:ro" --entrypoint sh api \
  -c 'cp -a /restore/. /data/objects/ && chown -R 10001:10001 /data/objects'
```

## Restore drill

Run this regularly (monthly, and after any upgrade of PostgreSQL or Qdrant). It reads the live install
and writes only to new names:

```sh
python scripts/ops/backup.py --output "$DRILL_DIR/backups"
python scripts/ops/restore.py "$DRILL_DIR"/backups/rackflow-backup-* \
    --target-db rackflow_restore_drill --target-collection rackflow_restore_drill \
    --target-storage "$DRILL_DIR/objects"
# exit 0 and "every count matches the manifest" is a pass. Then clean up:
psql "$ADMIN_URL" -c 'DROP DATABASE rackflow_restore_drill WITH (FORCE)'
curl -X DELETE http://127.0.0.1:6333/collections/rackflow_restore_drill
rm -rf "$DRILL_DIR"
```

Last drill: 2026-11-07 on the local Windows stack (PostgreSQL 18.6, Qdrant 1.20.0): 25 tables and
7,652 rows, 9 Qdrant points and 9 object files restored with every count matching; a second run
without `--force` was refused for all three targets, and with `--force` matched again.

## Tests

`backend/tests/test_backup_scripts.py` covers URL and settings handling, password scrubbing, retention,
the storage archive round trip and its path-traversal guards, manifest and checksum verification, the
refusal rules and the comparison, owner-only permissions (the mode check itself runs on POSIX only)
and `--chown`, with fakes in place of PostgreSQL and Qdrant.
