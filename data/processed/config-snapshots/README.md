# Config Snapshots

Local development snapshots for mutable SandFest configuration.

The admin API writes a snapshot before alert, ticket catalog, and sponsor configuration changes. Snapshots can be listed from the admin API and restored by roles with rollback permission. Production should move this to database-backed version history with reviewed rollback controls.
