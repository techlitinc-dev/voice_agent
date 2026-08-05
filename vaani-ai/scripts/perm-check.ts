import { hasPermission } from "../src/lib/permissions";

const viewer = { role: "VIEWER" as const, grantedPermissions: [] as string[], revokedPermissions: [] as string[] };
const admin = { role: "ADMIN" as const, grantedPermissions: [] as string[], revokedPermissions: [] as string[] };
const agent = { role: "AGENT" as const, grantedPermissions: [] as string[], revokedPermissions: [] as string[] };

console.log("viewer numbers:write =", hasPermission(viewer, "numbers:write"));
console.log("admin numbers:write =", hasPermission(admin, "numbers:write"));
console.log("agent numbers:write =", hasPermission(agent, "numbers:write"));
console.log("agent live:whisper =", hasPermission(agent, "live:whisper"));
