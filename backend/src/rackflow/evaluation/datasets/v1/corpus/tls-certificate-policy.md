# TLS Certificate Policy

All externally reachable services must use certificates issued by the corporate ACME service.
Certificates are rotated every 90 days, and renewal starts automatically 30 days before expiry.
The Security Engineering team owns this policy. Wildcard certificates are not permitted for
production services. Private keys must never leave the host that uses them.
