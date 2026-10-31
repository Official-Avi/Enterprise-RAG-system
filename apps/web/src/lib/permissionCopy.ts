// Plain-words copy for permission gates (§2.3, §7 #4). The UI is never the security boundary;
// this only explains what the API already enforces.

type RoleKey = "org_admin" | "engineer" | "operator" | "auditor";

const ROLE_ORDER: RoleKey[] = ["org_admin", "engineer", "operator", "auditor"];

const ROLE_PLURAL: Record<RoleKey, string> = {
  org_admin: "Admins",
  engineer: "Engineers",
  operator: "Operators",
  auditor: "Auditors",
};

const ALL: RoleKey[] = ROLE_ORDER;

/** "Admins, Operators and Auditors", always in the same role order. */
function plainRoles(roles: RoleKey[]): string {
  const words = ROLE_ORDER.filter((r) => roles.includes(r)).map((r) => ROLE_PLURAL[r]);
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function entry(roles: RoleKey[], page: string) {
  return { roles: plainRoles(roles), page };
}

/** Which roles may use each permission, in plain words, plus a friendly name for what it gates
 *  (§7 #4). Mirrors ROLE_PERMISSIONS in backend/src/rackflow/auth/rbac.py; change both together. */
export const PERMISSION_COPY: Record<string, { roles: string; page?: string }> = {
  "collection:read": entry(ALL, "Collections"),
  "collection:create": entry(["org_admin", "engineer"], "Creating collections"),
  "collection:manage": entry(["org_admin", "engineer"], "Managing collections"),
  "document:upload": entry(["org_admin", "engineer"], "Adding files"),
  "document:read_content": entry(["org_admin", "engineer", "operator"], "Document content"),
  "document:delete": entry(["org_admin", "engineer"], "Deleting documents"),
  "document:retry": entry(["org_admin", "engineer", "operator"], "Retrying documents"),
  "chat:use": entry(["org_admin", "engineer", "operator"], "Ask"),
  "retrieval:inspect": entry(["org_admin", "operator"], "Retrieval inspector"),
  "job:read": entry(ALL, "Job queue"),
  "job:manage": entry(["org_admin", "operator"], "Managing jobs"),
  "ops:read": entry(["org_admin", "operator", "auditor"], "Overview"),
  "model:read": entry(ALL, "Model serving"),
  "model:manage": entry(["org_admin"], "Model settings"),
  "infra:read": entry(ALL, "Racks & workloads"),
  "infra:manage": entry(["org_admin", "operator"], "Managing racks"),
  "user:read": entry(["org_admin", "auditor"], "Users & roles"),
  "user:manage": entry(["org_admin"], "Managing users"),
  "audit:read": entry(["org_admin", "auditor"], "Audit log"),
  "eval:read": entry(ALL, "Evaluation"),
  "eval:run": entry(["org_admin", "operator"], "Running evaluations"),
  "settings:manage": entry(["org_admin"], "Settings"),
};

/** Friendly page names by route, for "{Page} needs a different role". */
export const PAGE_NAMES: Record<string, string> = {
  "/ask": "Ask",
  "/library": "My documents",
  "/overview": "Overview",
  "/collections": "Collections",
  "/documents": "Documents",
  "/inspector": "Retrieval inspector",
  "/jobs": "Job queue",
  "/workers": "Workers",
  "/models": "Model serving",
  "/evaluation": "Evaluation",
  "/infrastructure": "Racks & workloads",
  "/admin/users": "Users & roles",
  "/admin/audit": "Audit log",
  "/admin/settings": "Settings",
};

/** The friendly name of the most specific route that owns `pathname` ("This page" if none). */
export function pageName(pathname: string): string {
  const owner = Object.keys(PAGE_NAMES)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
  return owner ? PAGE_NAMES[owner] : "This page";
}
