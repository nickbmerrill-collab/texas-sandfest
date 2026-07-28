import { ADMIN_DEPLOYMENT_WRITE, ADMIN_TASKS_WRITE } from "./admin-permission-names.mjs";

const entries = [
  ["super_admin", ["*"]],
  ["ops_admin", [
    "admin:read",
    "content:write",
    "documents:read",
    "documents:write",
    "alert:read",
    "alert:write",
    "orders:read",
    "payments:read",
    "revenue:read",
    "budget:read",
    "fleet:read",
    "fleet:write",
    "volunteers:read",
    "volunteers:write",
    "staff:write",
    "consent:read",
    "passport:read",
    "voting:read",
    "booths:read",
    "booths:write",
    "partners:read",
    "partners:write",
    "outreach:read",
    "outreach:write",
    "conditions:read",
    "conditions:write",
    "fulfillment:read",
    "fulfillment:update",
    ADMIN_TASKS_WRITE,
    ADMIN_DEPLOYMENT_WRITE,
    "jobs:write",
    "audit:read",
    "impact:read",
    "guest_services:read",
    "guest_services:write",
    "snapshot:read"
  ]],
  ["ticketing_admin", [
    "admin:read",
    "alert:read",
    "ticket:write",
    "orders:read",
    "payments:read",
    "revenue:read",
    "consent:read",
    "guest_services:read",
    "guest_services:write",
    "fulfillment:read",
    "audit:read",
    "snapshot:read"
  ]],
  ["sponsor_admin", [
    "admin:read",
    "alert:read",
    "sponsor:write",
    "partners:read",
    "partners:write",
    "outreach:read",
    "outreach:write",
    "orders:read",
    "fulfillment:read",
    "audit:read",
    "snapshot:read"
  ]],
  ["finance_admin", [
    "admin:read",
    "alert:read",
    "orders:read",
    "payments:read",
    "revenue:read",
    "revenue:write",
    "budget:read",
    "budget:write",
    "fleet:read",
    "volunteers:read",
    "consent:read",
    "passport:read",
    "voting:read",
    "booths:read",
    "partners:read",
    "documents:read",
    "finance:write",
    "conditions:read",
    "fulfillment:read",
    "audit:read",
    "impact:read",
    "guest_services:read",
    "snapshot:read"
  ]],
  ["viewer", [
    "admin:read",
    "alert:read",
    "orders:read",
    "payments:read",
    "revenue:read",
    "fleet:read",
    "volunteers:read",
    "consent:read",
    "passport:read",
    "voting:read",
    "booths:read",
    "partners:read",
    "outreach:read",
    "conditions:read",
    "fulfillment:read",
    "audit:read",
    "impact:read",
    "guest_services:read",
    "snapshot:read"
  ]]
];

export const ADMIN_ROLE_PERMISSIONS = Object.freeze(Object.fromEntries(
  entries.map(([role, permissions]) => [role, Object.freeze([...permissions])])
));

export const ADMIN_ROLES = Object.freeze(entries.map(([role]) => role));

export const ADMIN_ROLE_PRIORITY = ADMIN_ROLES;

export function adminRoleHasPermission(role, permission) {
  const permissions = ADMIN_ROLE_PERMISSIONS[role];
  return Boolean(permissions?.includes("*") || permissions?.includes(permission));
}
