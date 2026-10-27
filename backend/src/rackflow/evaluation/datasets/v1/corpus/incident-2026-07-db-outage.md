# Incident Report INC-2026-0714: Database outage

Date: 14 July 2026. Duration: 47 minutes. Severity: SEV-2.

## Summary
The primary database ran out of disk space after the WAL archive volume filled up, which stopped
all writes. Read traffic continued from the replica.

## Root cause
The WAL archiving job had silently failed for nine days because its credentials expired, so
archived WAL segments were never removed from the local volume.

## Corrective actions
- Alert when the WAL volume exceeds 70 percent usage.
- Rotate archiving credentials automatically every 30 days.
- Add the archiving job to the on-call health checklist.
