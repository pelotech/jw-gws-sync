/** Department-based Google Groups management */

import type { GoogleWorkspaceClient } from "./clients/google.ts";
import type { Config } from "./config.ts";
import type { CanonicalMember } from "./types/internal.ts";
import type { GroupSyncResult } from "./types/internal.ts";

export type Logger = {
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
};

const MANAGED_TAG = "Managed by jw-gws-sync";

export class GroupManager {
  constructor(
    private gws: GoogleWorkspaceClient,
    private config: Config,
    private logger: Logger,
  ) {}

  /**
   * Generate group email from department name.
   * Normalize: lowercase, replace spaces with hyphens, remove special chars.
   * Result: {prefix}-{normalized}@{domain}
   */
  static groupEmail(
    prefix: string,
    department: string,
    domain: string,
  ): string {
    const normalized = department
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
    return `${prefix}-${normalized}@${domain}`;
  }

  /**
   * Generate group display name.
   * Result: "{Prefix} {Department}"
   */
  static groupDisplayName(prefix: string, department: string): string {
    const capitalizedPrefix = prefix.charAt(0).toUpperCase() + prefix.slice(1);
    return `${capitalizedPrefix} ${department}`;
  }

  /**
   * Sync all department groups based on the current set of canonical members.
   *
   * 1. Collect unique departments from members
   * 2. Get existing managed groups
   * 3. For each department:
   *    a. Create group if it doesn't exist
   *    b. Get current members of the group
   *    c. Add members who should be in this department group but aren't
   *    d. Remove members who are in the group but shouldn't be
   * 4. For departments that no longer exist: leave groups as-is (don't delete)
   * 5. Return GroupSyncResult
   */
  async syncGroups(
    members: CanonicalMember[],
    dryRun: boolean,
  ): Promise<GroupSyncResult> {
    const result: GroupSyncResult = {
      groupsCreated: [],
      groupsDeleted: [],
      membersAdded: 0,
      membersRemoved: 0,
      errors: [],
    };

    // Step 1: Collect unique departments and build department -> emails map
    const deptMembers = new Map<string, Set<string>>();
    for (const member of members) {
      if (!member.department) continue;
      if (!deptMembers.has(member.department)) {
        deptMembers.set(member.department, new Set());
      }
      deptMembers.get(member.department)!.add(member.primaryEmail.toLowerCase());
    }

    // Step 2: Get existing managed groups
    const allGroups = await this.gws.listGroups();
    const managedGroups = new Map<string, string>(); // email -> name
    for (const group of allGroups) {
      if (group.description?.includes(MANAGED_TAG)) {
        managedGroups.set(group.email.toLowerCase(), group.name);
      }
    }

    // Step 3: Process each department
    for (const [department, expectedEmails] of deptMembers) {
      const groupEmail = GroupManager.groupEmail(
        this.config.groupPrefix,
        department,
        this.config.googleDomain,
      );
      const groupName = GroupManager.groupDisplayName(
        this.config.groupPrefix,
        department,
      );

      try {
        // Step 3a: Create group if it doesn't exist
        if (!managedGroups.has(groupEmail.toLowerCase())) {
          if (dryRun) {
            this.logger.info("[DRY RUN] Would create group", {
              groupEmail,
              groupName,
            });
          } else {
            await this.gws.createGroup({
              email: groupEmail,
              name: groupName,
              description: `${department} department group. ${MANAGED_TAG}.`,
            });
            this.logger.info("Created group", { groupEmail, groupName });
          }
          result.groupsCreated.push(groupEmail);
        }

        // Step 3b: Get current members of the group
        let currentMembers: Set<string>;
        if (dryRun && !managedGroups.has(groupEmail.toLowerCase())) {
          // Group doesn't exist yet in dry run — no members
          currentMembers = new Set();
        } else if (managedGroups.has(groupEmail.toLowerCase())) {
          const groupMembers = await this.gws.listGroupMembers(groupEmail);
          currentMembers = new Set(
            groupMembers.map((m) => m.email.toLowerCase()),
          );
        } else {
          // Newly created group — no members yet
          currentMembers = new Set();
        }

        // Step 3c: Add missing members
        for (const email of expectedEmails) {
          if (!currentMembers.has(email)) {
            if (dryRun) {
              this.logger.info("[DRY RUN] Would add member to group", {
                groupEmail,
                email,
              });
            } else {
              await this.gws.addGroupMember(groupEmail, email);
              this.logger.info("Added member to group", { groupEmail, email });
            }
            result.membersAdded++;
          }
        }

        // Step 3d: Remove members who shouldn't be in this group
        for (const email of currentMembers) {
          if (!expectedEmails.has(email)) {
            if (dryRun) {
              this.logger.info("[DRY RUN] Would remove member from group", {
                groupEmail,
                email,
              });
            } else {
              await this.gws.removeGroupMember(groupEmail, email);
              this.logger.info("Removed member from group", {
                groupEmail,
                email,
              });
            }
            result.membersRemoved++;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`Error syncing group ${groupEmail}: ${message}`);
        this.logger.error("Error syncing group", {
          groupEmail,
          error: message,
        });
      }
    }

    return result;
  }
}
