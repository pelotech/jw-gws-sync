/** Internal canonical types for sync operations */

export interface CanonicalMember {
  justworksId: string;
  givenName: string;
  familyName: string;
  preferredName?: string;
  primaryEmail: string;
  workPhone?: string;
  jobTitle?: string;
  department?: string;
  managerId?: string;
  orgUnitPath: string;
  isActive: boolean;
}

export type SyncAction =
  | { type: "CREATE"; member: CanonicalMember }
  | {
    type: "UPDATE";
    email: string;
    changes: Record<string, unknown>;
    member: CanonicalMember;
  }
  | { type: "SUSPEND"; email: string; justworksId: string }
  | {
    type: "SKIP_PROTECTED";
    email: string;
    justworksId: string;
    reason: string;
  }
  | { type: "NO_CHANGE"; email: string };

export interface SyncError {
  action: SyncAction;
  error: string;
  retryable: boolean;
}

export interface SyncResult {
  actions: SyncAction[];
  errors: SyncError[];
  summary: {
    created: number;
    updated: number;
    suspended: number;
    skipped: number;
    unchanged: number;
    errored: number;
  };
  dryRun: boolean;
  timestamp: string;
}

export interface GroupSyncResult {
  groupsCreated: string[];
  groupsDeleted: string[];
  membersAdded: number;
  membersRemoved: number;
  errors: string[];
}
