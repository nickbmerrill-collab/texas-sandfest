# Admin Audit Records

Local development audit trail for privileged SandFest admin mutations.

Records are written as JSON when admins publish or clear alerts, update ticket products, update sponsor packages, or change fulfillment status. Production should move these records into append-only database storage with user identity, role, request ID, and retention policy.
