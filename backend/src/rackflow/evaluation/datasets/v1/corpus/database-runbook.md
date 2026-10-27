# Database Operations Runbook

## Connection pool exhaustion
Symptom: API requests fail with the error "connection pool exhausted" and latency rises sharply.

Resolution: restart the rackflow-api service first. If the error returns within one hour, raise
max_connections in postgresql.conf from 100 to 200 and reload PostgreSQL with pg_ctl reload.

## Replica failover
Only fail over when the primary has been unreachable for more than 60 seconds.

1. Promote the standby with: pg_ctl promote -D /var/lib/postgresql/data
2. Update the db.internal DNS record so it points to the new primary.
3. Rebuild the old primary as a standby before returning it to service.
