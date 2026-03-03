import { APIError } from "encore.dev/api";
import { getMembership, Role } from "./db";

export async function authorizeOrg(
  orgId: string,
  userId: string,
  minRole: Role = "org_member"
) {
  const membership = await getMembership(orgId, userId);

  if (!membership) {
    throw APIError.permissionDenied("Not a member");
  }

  const levels = {
    org_viewer: 1,
    org_member: 2,
    org_admin: 3,
    org_owner: 4,
  };

  if (levels[membership.role] < levels[minRole]) {
    throw APIError.permissionDenied("Insufficient role");
  }

  return membership;
}