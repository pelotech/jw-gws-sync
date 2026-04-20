import { assertEquals } from "@std/assert";
import {
  computeFieldDiff,
  computeSyncActions,
  toCanonical,
} from "../src/diff.ts";
import type { CanonicalMember } from "../src/types/internal.ts";
import type { GoogleUser } from "../src/types/google.ts";
import type { JustworksMember } from "../src/types/justworks.ts";

// --- Helpers ---

function makeMember(
  overrides: Partial<JustworksMember> = {},
): JustworksMember {
  return {
    id: "jw-001",
    given_name: "John",
    family_name: "Doe",
    emails: [],
    phones: [],
    employment_start_date: "2024-01-01",
    employment_status: "ACTIVE",
    ...overrides,
  };
}

function makeCanonical(
  overrides: Partial<CanonicalMember> = {},
): CanonicalMember {
  return {
    justworksId: "jw-001",
    givenName: "John",
    familyName: "Doe",
    primaryEmail: "john.doe@example.com",
    orgUnitPath: "/",
    isActive: true,
    ...overrides,
  };
}

function makeGoogleUser(
  overrides: Partial<GoogleUser> = {},
): GoogleUser {
  return {
    primaryEmail: "john.doe@example.com",
    name: { givenName: "John", familyName: "Doe" },
    suspended: false,
    orgUnitPath: "/",
    externalIds: [
      { type: "custom", customType: "justworks_id", value: "jw-001" },
    ],
    ...overrides,
  };
}

// --- toCanonical() tests ---

Deno.test("toCanonical: basic member conversion", () => {
  const member = makeMember({
    job_title: "Engineer",
    department: { id: "d-1", name: "Engineering" },
    phones: [{ type: "WORK", number: "+1234567890" }],
    manager: { id: "jw-mgr" },
  });

  const result = toCanonical(member, "john.doe@example.com", "/Employees");

  assertEquals(result.justworksId, "jw-001");
  assertEquals(result.givenName, "John");
  assertEquals(result.familyName, "Doe");
  assertEquals(result.primaryEmail, "john.doe@example.com");
  assertEquals(result.workPhone, "+1234567890");
  assertEquals(result.jobTitle, "Engineer");
  assertEquals(result.department, "Engineering");
  assertEquals(result.managerId, "jw-mgr");
  assertEquals(result.orgUnitPath, "/Employees");
  assertEquals(result.isActive, true);
});

Deno.test("toCanonical: uses preferred_name as givenName", () => {
  const member = makeMember({
    given_name: "Jonathan",
    preferred_name: "Johnny",
  });

  const result = toCanonical(member, "john.doe@example.com", "/");
  assertEquals(result.givenName, "Johnny");
  assertEquals(result.preferredName, "Johnny");
});

Deno.test("toCanonical: falls back to given_name when preferred_name is empty", () => {
  const member = makeMember({
    given_name: "Jonathan",
    preferred_name: "  ",
  });

  const result = toCanonical(member, "john.doe@example.com", "/");
  assertEquals(result.givenName, "Jonathan");
});

Deno.test("toCanonical: handles missing optional fields", () => {
  const member = makeMember();

  const result = toCanonical(member, "john.doe@example.com", "/");
  assertEquals(result.workPhone, undefined);
  assertEquals(result.jobTitle, undefined);
  assertEquals(result.department, undefined);
  assertEquals(result.managerId, undefined);
});

// --- computeFieldDiff() tests ---

Deno.test("computeFieldDiff: no changes returns empty object", () => {
  const member = makeCanonical();
  const gu = makeGoogleUser();

  const diff = computeFieldDiff(member, gu);
  assertEquals(Object.keys(diff).length, 0);
});

Deno.test("computeFieldDiff: detects name change", () => {
  const member = makeCanonical({ givenName: "Johnny" });
  const gu = makeGoogleUser();

  const diff = computeFieldDiff(member, gu);
  assertEquals(diff.givenName, "Johnny");
  assertEquals(diff.familyName, undefined);
});

Deno.test("computeFieldDiff: detects job title change", () => {
  const member = makeCanonical({ jobTitle: "Senior Engineer" });
  const gu = makeGoogleUser({
    organizations: [
      { title: "Engineer", department: undefined, primary: true },
    ],
  });

  const diff = computeFieldDiff(member, gu);
  assertEquals(diff.jobTitle, "Senior Engineer");
});

Deno.test("computeFieldDiff: detects department change", () => {
  const member = makeCanonical({ department: "Product" });
  const gu = makeGoogleUser({
    organizations: [
      { title: undefined, department: "Engineering", primary: true },
    ],
  });

  const diff = computeFieldDiff(member, gu);
  assertEquals(diff.department, "Product");
});

Deno.test("computeFieldDiff: detects org unit path change", () => {
  const member = makeCanonical({ orgUnitPath: "/Employees" });
  const gu = makeGoogleUser({ orgUnitPath: "/" });

  const diff = computeFieldDiff(member, gu);
  assertEquals(diff.orgUnitPath, "/Employees");
});

// --- computeSyncActions() tests ---

Deno.test("computeSyncActions: new member creates CREATE action", () => {
  const members = [makeCanonical()];
  const googleUsers: GoogleUser[] = [];
  const protectedEmails = new Set<string>();

  const actions = computeSyncActions(members, googleUsers, protectedEmails);

  assertEquals(actions.length, 1);
  assertEquals(actions[0].type, "CREATE");
});

Deno.test("computeSyncActions: matching member with no changes creates NO_CHANGE", () => {
  const members = [makeCanonical()];
  const googleUsers = [makeGoogleUser()];
  const protectedEmails = new Set<string>();

  const actions = computeSyncActions(members, googleUsers, protectedEmails);

  assertEquals(actions.length, 1);
  assertEquals(actions[0].type, "NO_CHANGE");
});

Deno.test("computeSyncActions: matching member with field changes creates UPDATE", () => {
  const members = [makeCanonical({ givenName: "Johnny" })];
  const googleUsers = [makeGoogleUser()];
  const protectedEmails = new Set<string>();

  const actions = computeSyncActions(members, googleUsers, protectedEmails);

  assertEquals(actions.length, 1);
  assertEquals(actions[0].type, "UPDATE");
  if (actions[0].type === "UPDATE") {
    assertEquals(actions[0].changes.givenName, "Johnny");
  }
});

Deno.test("computeSyncActions: terminated member creates SUSPEND", () => {
  const members: CanonicalMember[] = []; // member no longer active in JW
  const googleUsers = [makeGoogleUser()];
  const protectedEmails = new Set<string>();

  const actions = computeSyncActions(members, googleUsers, protectedEmails);

  assertEquals(actions.length, 1);
  assertEquals(actions[0].type, "SUSPEND");
});

Deno.test("computeSyncActions: protected member creates SKIP_PROTECTED", () => {
  const members: CanonicalMember[] = [];
  const googleUsers = [makeGoogleUser()];
  const protectedEmails = new Set(["john.doe@example.com"]);

  const actions = computeSyncActions(members, googleUsers, protectedEmails);

  assertEquals(actions.length, 1);
  assertEquals(actions[0].type, "SKIP_PROTECTED");
});

Deno.test("computeSyncActions: suspended Google user with active JW member creates UPDATE to unsuspend", () => {
  const members = [makeCanonical()];
  const googleUsers = [makeGoogleUser({ suspended: true })];
  const protectedEmails = new Set<string>();

  const actions = computeSyncActions(members, googleUsers, protectedEmails);

  assertEquals(actions.length, 1);
  assertEquals(actions[0].type, "UPDATE");
  if (actions[0].type === "UPDATE") {
    assertEquals(actions[0].changes.suspended, false);
  }
});

Deno.test("computeSyncActions: Google user without externalId is not touched for suspend", () => {
  const members: CanonicalMember[] = [];
  const googleUsers = [
    makeGoogleUser({
      primaryEmail: "unmanaged@example.com",
      externalIds: undefined, // No justworks_id
    }),
  ];
  const protectedEmails = new Set<string>();

  const actions = computeSyncActions(members, googleUsers, protectedEmails);

  // Should not produce any SUSPEND action for this user
  assertEquals(actions.length, 0);
});

Deno.test("computeSyncActions: email fallback matching for bootstrapping", () => {
  const members = [makeCanonical({ justworksId: "jw-new" })];
  const googleUsers = [
    makeGoogleUser({
      externalIds: undefined, // No externalId yet
      primaryEmail: "john.doe@example.com",
    }),
  ];
  const protectedEmails = new Set<string>();

  const actions = computeSyncActions(members, googleUsers, protectedEmails);

  assertEquals(actions.length, 1);
  assertEquals(actions[0].type, "UPDATE");
  if (actions[0].type === "UPDATE") {
    // Should stamp the externalId
    assertEquals(actions[0].changes.externalId, "jw-new");
  }
});

Deno.test("computeSyncActions: already suspended Google user is not re-suspended", () => {
  const members: CanonicalMember[] = [];
  const googleUsers = [
    makeGoogleUser({
      suspended: true,
    }),
  ];
  const protectedEmails = new Set<string>();

  const actions = computeSyncActions(members, googleUsers, protectedEmails);

  // Already suspended, should not produce a SUSPEND action
  assertEquals(actions.length, 0);
});
