/** Reconciliation engine — pure functions, no side effects */

import type { CanonicalMember, SyncAction } from "./types/internal.ts";
import type { GoogleUser } from "./types/google.ts";
import type { JustworksMember } from "./types/justworks.ts";

/**
 * Normalize a JustworksMember into a CanonicalMember.
 * Uses preferred_name as givenName if set.
 * Extracts work phone, department name, etc.
 */
export function toCanonical(
  member: JustworksMember,
  email: string,
  defaultOrgUnit: string,
): CanonicalMember {
  const workPhone = member.phones.find((p) => p.type === "WORK");

  return {
    justworksId: member.id,
    givenName: member.preferred_name?.trim() || member.given_name,
    familyName: member.family_name,
    preferredName: member.preferred_name,
    primaryEmail: email,
    workPhone: workPhone?.number,
    jobTitle: member.job_title,
    department: member.department?.name,
    managerId: member.manager?.id,
    orgUnitPath: defaultOrgUnit,
    isActive: member.employment_status === "ACTIVE",
  };
}

/**
 * Compare a CanonicalMember against a GoogleUser and return changed fields.
 * Compares: givenName, familyName, jobTitle, department, workPhone, orgUnitPath.
 * Returns empty object if no changes.
 */
export function computeFieldDiff(
  member: CanonicalMember,
  googleUser: GoogleUser,
): Partial<CanonicalMember> {
  const changes: Partial<CanonicalMember> = {};

  if (member.givenName !== googleUser.name.givenName) {
    changes.givenName = member.givenName;
  }
  if (member.familyName !== googleUser.name.familyName) {
    changes.familyName = member.familyName;
  }

  // Compare job title
  const googleOrg = googleUser.organizations?.find((o) => o.primary);
  const googleTitle = googleOrg?.title ?? undefined;
  if (member.jobTitle !== googleTitle) {
    changes.jobTitle = member.jobTitle;
  }

  // Compare department
  const googleDept = googleOrg?.department ?? undefined;
  if (member.department !== googleDept) {
    changes.department = member.department;
  }

  // Compare work phone
  const googlePhone = googleUser.phones?.find((p) => p.type === "work");
  const googlePhoneValue = googlePhone?.value ?? undefined;
  if (member.workPhone !== googlePhoneValue) {
    changes.workPhone = member.workPhone;
  }

  // Compare org unit path
  if (member.orgUnitPath !== googleUser.orgUnitPath) {
    changes.orgUnitPath = member.orgUnitPath;
  }

  return changes;
}

/**
 * Main reconciliation function. PURE — no side effects, no API calls.
 *
 * Inputs:
 *   jwMembers: already normalized CanonicalMember[]
 *   googleUsers: GoogleUser[]
 *   protectedEmails: Set<string> (emails of users in the protected group)
 *
 * Algorithm:
 *   1. Build maps: googleByJwId (from externalIds), googleByEmail
 *   2. For each JW member:
 *      - Find Google user by externalId (primary), fallback to email
 *      - No match -> CREATE
 *      - Match + field changes -> UPDATE (include externalId stamp if missing)
 *      - Match + no changes -> NO_CHANGE
 *      - Match + user suspended in Google but active in JW -> UPDATE (unsuspend)
 *   3. For each Google user WITH a justworks_id that is NOT in jwMembers:
 *      - If email is in protectedEmails -> SKIP_PROTECTED
 *      - Otherwise -> SUSPEND
 *   4. Return SyncAction[]
 */
export function computeSyncActions(
  jwMembers: CanonicalMember[],
  googleUsers: GoogleUser[],
  protectedEmails: Set<string>,
): SyncAction[] {
  const actions: SyncAction[] = [];

  // Build lookup maps
  const googleByJwId = new Map<string, GoogleUser>();
  const googleByEmail = new Map<string, GoogleUser>();

  for (const gu of googleUsers) {
    googleByEmail.set(gu.primaryEmail.toLowerCase(), gu);
    const jwExternalId = gu.externalIds?.find(
      (eid) => eid.type === "custom" && eid.customType === "justworks_id",
    );
    if (jwExternalId) {
      googleByJwId.set(jwExternalId.value, gu);
    }
  }

  // Track which Google users are matched to a JW member
  const matchedGoogleEmails = new Set<string>();

  // Process each JW member
  for (const member of jwMembers) {
    // Find Google user: primary by externalId, fallback by email
    const googleUser =
      googleByJwId.get(member.justworksId) ??
      googleByEmail.get(member.primaryEmail.toLowerCase()) ??
      null;

    if (!googleUser) {
      actions.push({ type: "CREATE", member });
      continue;
    }

    matchedGoogleEmails.add(googleUser.primaryEmail.toLowerCase());

    // Check if externalId stamp is missing (email fallback match)
    const hasJwId = googleUser.externalIds?.some(
      (eid) => eid.type === "custom" && eid.customType === "justworks_id",
    );

    // Compute field diff
    const fieldChanges = computeFieldDiff(member, googleUser);
    const hasFieldChanges = Object.keys(fieldChanges).length > 0;

    // Check if user needs unsuspending
    const needsUnsuspend = googleUser.suspended && member.isActive;

    // Build changes record
    const changes: Record<string, unknown> = {};

    if (hasFieldChanges) {
      Object.assign(changes, fieldChanges);
    }

    if (needsUnsuspend) {
      changes.suspended = false;
    }

    if (!hasJwId) {
      changes.externalId = member.justworksId;
    }

    if (Object.keys(changes).length > 0) {
      actions.push({
        type: "UPDATE",
        email: googleUser.primaryEmail,
        changes,
        member,
      });
    } else {
      actions.push({ type: "NO_CHANGE", email: googleUser.primaryEmail });
    }
  }

  // Process Google users with justworks_id that are NOT in jwMembers
  for (const gu of googleUsers) {
    const jwExternalId = gu.externalIds?.find(
      (eid) => eid.type === "custom" && eid.customType === "justworks_id",
    );
    if (!jwExternalId) {
      continue; // No justworks_id — not managed by us
    }

    if (matchedGoogleEmails.has(gu.primaryEmail.toLowerCase())) {
      continue; // Already matched
    }

    // Check if this justworks_id is claimed by any JW member
    const isClaimedById = jwMembers.some(
      (m) => m.justworksId === jwExternalId.value,
    );
    if (isClaimedById) {
      continue; // Matched by ID (different email), already processed
    }

    if (gu.suspended) {
      continue; // Already suspended
    }

    const emailLower = gu.primaryEmail.toLowerCase();
    if (protectedEmails.has(emailLower)) {
      actions.push({
        type: "SKIP_PROTECTED",
        email: gu.primaryEmail,
        justworksId: jwExternalId.value,
        reason: "Member in protected group",
      });
    } else {
      actions.push({
        type: "SUSPEND",
        email: gu.primaryEmail,
        justworksId: jwExternalId.value,
      });
    }
  }

  return actions;
}
