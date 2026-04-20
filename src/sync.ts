/** Sync orchestrator — coordinates full and single-member syncs */

import type { JustworksClient } from "./clients/justworks.ts";
import type { GoogleWorkspaceClient } from "./clients/google.ts";
import type { EmailGenerator } from "./email.ts";
import type { GroupManager } from "./groups.ts";
import type { Config } from "./config.ts";
import type {
  CanonicalMember,
  SyncAction,
  SyncResult,
} from "./types/internal.ts";
import type { UpdateUserPayload } from "./types/google.ts";
import { computeSyncActions, toCanonical } from "./diff.ts";

export type Logger = {
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
};

export class SyncOrchestrator {
  constructor(
    private jw: JustworksClient,
    private gws: GoogleWorkspaceClient,
    private emailGenerator: EmailGenerator,
    private groupManager: GroupManager,
    private config: Config,
    private logger: Logger,
  ) {}

  /** Full sync: called by scheduler. */
  async fullSync(): Promise<SyncResult> {
    const timestamp = new Date().toISOString();
    const result: SyncResult = {
      actions: [],
      errors: [],
      summary: {
        created: 0,
        updated: 0,
        suspended: 0,
        skipped: 0,
        unchanged: 0,
        errored: 0,
      },
      dryRun: this.config.dryRun,
      timestamp,
    };

    try {
      // Step 1: Fetch all active members from Justworks
      this.logger.info("Fetching active members from Justworks");
      const allMembers = await this.jw.listActiveMembers();
      this.logger.info("Fetched Justworks members", {
        count: allMembers.length,
      });

      // Step 2: Filter by configured departments
      const filtered = allMembers.filter((m) =>
        this.matchesDepartmentFilter(m.department?.name)
      );
      this.logger.info("Filtered members by department", {
        before: allMembers.length,
        after: filtered.length,
        syncDepartments: this.config.syncDepartments,
      });

      // Step 3: Fetch all Google Workspace users
      this.logger.info("Fetching Google Workspace users");
      const googleUsers = await this.gws.listUsers();
      this.logger.info("Fetched Google users", { count: googleUsers.length });

      // Step 4: Fetch protected group members
      const protectedEmails = await this.fetchProtectedEmails();

      // Step 5: Resolve emails for each JW member
      this.emailGenerator.resetBatchCache();
      const canonicalMembers: CanonicalMember[] = [];
      for (const member of filtered) {
        const email = await this.emailGenerator.resolveEmail(member);
        // Step 6: Convert to CanonicalMember
        const canonical = toCanonical(
          member,
          email,
          this.config.defaultOrgUnitPath,
        );
        canonicalMembers.push(canonical);
      }

      // Step 7: Compute diff
      const actions = computeSyncActions(
        canonicalMembers,
        googleUsers,
        protectedEmails,
      );
      result.actions = actions;

      // Step 8: Circuit breaker
      const suspendCount = actions.filter((a) => a.type === "SUSPEND").length;
      if (suspendCount > this.config.maxDeletesPerSync) {
        this.logger.error("Circuit breaker triggered", {
          suspendCount,
          maxDeletesPerSync: this.config.maxDeletesPerSync,
        });
        throw new Error(
          `Circuit breaker: ${suspendCount} suspensions exceed max of ${this.config.maxDeletesPerSync}`,
        );
      }

      // Step 9: Dry run logging
      if (this.config.dryRun) {
        for (const action of actions) {
          this.logger.info(`[DRY RUN] ${action.type}`, {
            action: action as unknown as Record<string, unknown>,
          });
        }
        this.summarizeActions(result);
        // Step 12: Reset email generator batch cache
        this.emailGenerator.resetBatchCache();
        return result;
      }

      // Step 10: Execute user actions sequentially with rate limiting
      for (const action of actions) {
        try {
          await this.executeAction(action);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          result.errors.push({
            action,
            error: message,
            retryable: message.includes("500") ||
              message.includes("502") ||
              message.includes("503") ||
              message.includes("504") ||
              message.includes("429") ||
              message.includes("timeout"),
          });
          this.logger.error("Action execution failed", {
            type: action.type,
            error: message,
          });
        }

        // Rate limiting between actions
        if (this.config.rateLimitDelayMs > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.config.rateLimitDelayMs)
          );
        }
      }

      // Step 11: Sync department groups
      this.logger.info("Syncing department groups");
      const groupResult = await this.groupManager.syncGroups(
        canonicalMembers,
        this.config.dryRun,
      );
      this.logger.info("Group sync complete", {
        groupsCreated: groupResult.groupsCreated.length,
        membersAdded: groupResult.membersAdded,
        membersRemoved: groupResult.membersRemoved,
        errors: groupResult.errors.length,
      });

      // Step 12: Reset email generator batch cache
      this.emailGenerator.resetBatchCache();

      this.summarizeActions(result);

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Full sync failed", { error: message });
      result.errors.push({
        action: { type: "NO_CHANGE", email: "N/A" },
        error: message,
        retryable: false,
      });
      result.summary.errored++;
      return result;
    }
  }

  /** Single member sync: called by webhook handler. */
  async syncMember(justworksId: string): Promise<SyncAction> {
    // Step 1: Fetch member from JW by ID
    const member = await this.jw.getMember(justworksId);

    // Step 2: Check department filter
    if (!this.matchesDepartmentFilter(member.department?.name)) {
      this.logger.info("Member filtered out by department", {
        justworksId,
        department: member.department?.name,
      });
      return { type: "NO_CHANGE", email: "" };
    }

    // Step 3: Fetch protected group members
    const protectedEmails = await this.fetchProtectedEmails();

    // Step 4: Resolve email
    const email = await this.emailGenerator.resolveEmail(member);

    // Step 5: Convert to canonical
    const canonical = toCanonical(
      member,
      email,
      this.config.defaultOrgUnitPath,
    );

    // Step 6: Find Google user (by externalId scan or email)
    const googleUsers = await this.gws.listUsers();

    // Step 7: Compute single action via the shared reconciliation engine
    const actions = computeSyncActions(
      [canonical],
      googleUsers,
      protectedEmails,
    );
    const action: SyncAction = actions.find(
      (a) =>
        (a.type === "CREATE" &&
          a.member.justworksId === canonical.justworksId) ||
        (a.type === "UPDATE" &&
          a.member.justworksId === canonical.justworksId) ||
        (a.type === "NO_CHANGE") ||
        (a.type === "SKIP_PROTECTED") ||
        (a.type === "SUSPEND"),
    ) ?? { type: "NO_CHANGE", email: canonical.primaryEmail };

    // Step 8: Execute if not dry-run
    if (!this.config.dryRun) {
      await this.executeAction(action);
    } else {
      this.logger.info(`[DRY RUN] ${action.type}`, {
        action: action as unknown as Record<string, unknown>,
      });
    }

    // Step 9: Update group membership
    await this.groupManager.syncGroups([canonical], this.config.dryRun);

    return action;
  }

  /** Execute a single sync action. */
  private async executeAction(action: SyncAction): Promise<void> {
    switch (action.type) {
      case "CREATE": {
        const password = this.generatePassword();
        await this.gws.createUser({
          primaryEmail: action.member.primaryEmail,
          name: {
            givenName: action.member.givenName,
            familyName: action.member.familyName,
          },
          password,
          changePasswordAtNextLogin: true,
          orgUnitPath: action.member.orgUnitPath,
          externalIds: [
            {
              type: "custom",
              customType: "justworks_id",
              value: action.member.justworksId,
            },
          ],
          organizations: [
            {
              title: action.member.jobTitle,
              department: action.member.department,
              primary: true,
            },
          ],
          phones: action.member.workPhone
            ? [{ value: action.member.workPhone, type: "work" }]
            : undefined,
          relations: action.member.managerId
            ? [{ value: action.member.managerId, type: "manager" }]
            : undefined,
        });
        this.logger.info("Created user", {
          email: action.member.primaryEmail,
          justworksId: action.member.justworksId,
        });
        break;
      }
      case "UPDATE": {
        const payload: Record<string, unknown> = {};

        // Build update payload from changes
        if (
          action.changes.givenName !== undefined ||
          action.changes.familyName !== undefined
        ) {
          payload.name = {
            givenName: (action.changes.givenName as string) ??
              action.member.givenName,
            familyName: (action.changes.familyName as string) ??
              action.member.familyName,
          };
        }

        if (
          action.changes.jobTitle !== undefined ||
          action.changes.department !== undefined
        ) {
          payload.organizations = [
            {
              title: action.member.jobTitle,
              department: action.member.department,
              primary: true,
            },
          ];
        }

        if (action.changes.workPhone !== undefined) {
          payload.phones = action.member.workPhone
            ? [{ value: action.member.workPhone, type: "work" }]
            : [];
        }

        if (action.changes.orgUnitPath !== undefined) {
          payload.orgUnitPath = action.member.orgUnitPath;
        }

        if (action.changes.suspended !== undefined) {
          payload.suspended = action.changes.suspended;
        }

        if (action.changes.externalId !== undefined) {
          payload.externalIds = [
            {
              type: "custom",
              customType: "justworks_id",
              value: action.member.justworksId,
            },
          ];
        }

        await this.gws.updateUser(
          action.email,
          payload as UpdateUserPayload,
        );
        this.logger.info("Updated user", {
          email: action.email,
          changes: action.changes,
        });
        break;
      }
      case "SUSPEND": {
        await this.gws.suspendUser(action.email);
        this.logger.info("Suspended user", {
          email: action.email,
          justworksId: action.justworksId,
        });
        break;
      }
      case "SKIP_PROTECTED": {
        this.logger.info("Skipped protected user", {
          email: action.email,
          justworksId: action.justworksId,
          reason: action.reason,
        });
        break;
      }
      case "NO_CHANGE": {
        // Nothing to do
        break;
      }
    }
  }

  /** Generate a random password for new accounts. */
  private generatePassword(): string {
    const chars =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    const array = new Uint8Array(24);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => chars[b % chars.length]).join("");
  }

  /** Check if a department matches the sync filter. */
  private matchesDepartmentFilter(departmentName?: string): boolean {
    if (this.config.syncDepartments === "*") {
      return true;
    }

    if (!departmentName) {
      return this.config.syncIncludeNoDepartment;
    }

    const allowedDepts = this.config.syncDepartments
      .split(",")
      .map((d) => d.trim().toLowerCase());

    return allowedDepts.includes(departmentName.toLowerCase());
  }

  /** Fetch protected group member emails, or return empty set if no group configured. */
  private async fetchProtectedEmails(): Promise<Set<string>> {
    if (!this.config.protectedGroup) {
      return new Set<string>();
    }
    const protectedMembers = await this.gws.listGroupMembers(
      this.config.protectedGroup,
    );
    const emails = new Set(
      protectedMembers.map((m) => m.email.toLowerCase()),
    );
    this.logger.info("Fetched protected group members", {
      group: this.config.protectedGroup,
      count: emails.size,
    });
    return emails;
  }

  /** Summarize actions into the result summary. */
  private summarizeActions(result: SyncResult): void {
    for (const action of result.actions) {
      switch (action.type) {
        case "CREATE":
          result.summary.created++;
          break;
        case "UPDATE":
          result.summary.updated++;
          break;
        case "SUSPEND":
          result.summary.suspended++;
          break;
        case "SKIP_PROTECTED":
          result.summary.skipped++;
          break;
        case "NO_CHANGE":
          result.summary.unchanged++;
          break;
      }
    }
    result.summary.errored = result.errors.length;
  }
}
