import { assertEquals } from "@std/assert";
import { EmailGenerator } from "../src/email.ts";
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

/** Stub GoogleWorkspaceClient that returns users from a predefined map. */
function makeStubGws(existingEmails: string[] = []) {
  const emailSet = new Set(existingEmails.map((e) => e.toLowerCase()));
  return {
    getUser(email: string): Promise<GoogleUser | null> {
      if (emailSet.has(email.toLowerCase())) {
        return Promise.resolve({
          primaryEmail: email,
          name: { givenName: "Existing", familyName: "User" },
          suspended: false,
          orgUnitPath: "/",
        });
      }
      return Promise.resolve(null);
    },
    // Unused stubs to satisfy the type
    listUsers: () => Promise.resolve([]),
    listGroups: () => Promise.resolve([]),
    listGroupMembers: () => Promise.resolve([]),
    createUser: () => Promise.resolve({} as GoogleUser),
    updateUser: () => Promise.resolve({} as GoogleUser),
    suspendUser: () => Promise.resolve(),
    createGroup: () => Promise.resolve({} as never),
    deleteGroup: () => Promise.resolve(),
    addGroupMember: () => Promise.resolve(),
    removeGroupMember: () => Promise.resolve(),
  };
}

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// --- normalize() tests ---

Deno.test("normalize: strips diacritics", () => {
  assertEquals(EmailGenerator.normalize("José"), "jose");
  assertEquals(EmailGenerator.normalize("François"), "francois");
  assertEquals(EmailGenerator.normalize("Ñoño"), "nono");
});

Deno.test("normalize: replaces spaces and hyphens with dots", () => {
  assertEquals(EmailGenerator.normalize("Mary Jane"), "mary.jane");
  assertEquals(EmailGenerator.normalize("O'Brien-Smith"), "obrien.smith");
  assertEquals(EmailGenerator.normalize("Anna-Marie"), "anna.marie");
});

Deno.test("normalize: removes special characters", () => {
  assertEquals(EmailGenerator.normalize("John (Jr.)"), "john.jr");
  assertEquals(EmailGenerator.normalize("Test!!!"), "test");
});

Deno.test("normalize: handles uppercase", () => {
  assertEquals(EmailGenerator.normalize("JOHN"), "john");
  assertEquals(EmailGenerator.normalize("McFly"), "mcfly");
});

Deno.test("normalize: handles empty and whitespace", () => {
  assertEquals(EmailGenerator.normalize(""), "");
  assertEquals(EmailGenerator.normalize("  "), "");
});

// --- resolveEmail() tests ---

Deno.test("resolveEmail: uses work email when matching domain", async () => {
  const gws = makeStubGws();
  const gen = new EmailGenerator("example.com", gws as never, noopLogger);

  const member = makeMember({
    emails: [
      { type: "PERSONAL", address: "john@gmail.com" },
      { type: "WORK", address: "john.doe@example.com" },
    ],
  });

  const email = await gen.resolveEmail(member);
  assertEquals(email, "john.doe@example.com");
});

Deno.test("resolveEmail: ignores work email on different domain", async () => {
  const gws = makeStubGws();
  const gen = new EmailGenerator("example.com", gws as never, noopLogger);

  const member = makeMember({
    emails: [{ type: "WORK", address: "john@other.com" }],
  });

  const email = await gen.resolveEmail(member);
  assertEquals(email, "john.doe@example.com");
});

Deno.test("resolveEmail: generates from name when no work email", async () => {
  const gws = makeStubGws();
  const gen = new EmailGenerator("example.com", gws as never, noopLogger);

  const member = makeMember({
    given_name: "Jane",
    family_name: "Smith",
    emails: [{ type: "PERSONAL", address: "jane@gmail.com" }],
  });

  const email = await gen.resolveEmail(member);
  assertEquals(email, "jane.smith@example.com");
});

Deno.test("resolveEmail: conflict resolution appends numbers", async () => {
  const gws = makeStubGws(["john.doe@example.com"]);
  const gen = new EmailGenerator("example.com", gws as never, noopLogger);

  const member = makeMember({ id: "jw-002" });

  const email = await gen.resolveEmail(member);
  assertEquals(email, "john.doe2@example.com");
});

Deno.test("resolveEmail: conflict resolution tries middle initial first", async () => {
  const gws = makeStubGws(["john.doe@example.com"]);
  const gen = new EmailGenerator("example.com", gws as never, noopLogger);

  const member = makeMember({
    id: "jw-003",
    preferred_name: "John M. Doe",
  });

  const email = await gen.resolveEmail(member);
  assertEquals(email, "john.m.doe@example.com");
});

Deno.test("resolveEmail: batch cache prevents duplicates within same batch", async () => {
  const gws = makeStubGws();
  const gen = new EmailGenerator("example.com", gws as never, noopLogger);

  const member1 = makeMember({ id: "jw-001" });
  const member2 = makeMember({ id: "jw-002" });

  const email1 = await gen.resolveEmail(member1);
  const email2 = await gen.resolveEmail(member2);

  assertEquals(email1, "john.doe@example.com");
  assertEquals(email2, "john.doe2@example.com");
});

Deno.test("resolveEmail: resetBatchCache clears the cache", async () => {
  const gws = makeStubGws();
  const gen = new EmailGenerator("example.com", gws as never, noopLogger);

  const member1 = makeMember({ id: "jw-001" });
  await gen.resolveEmail(member1);

  gen.resetBatchCache();

  // Same name should now resolve to the same email since cache is cleared
  const member2 = makeMember({ id: "jw-002" });
  const email2 = await gen.resolveEmail(member2);
  assertEquals(email2, "john.doe@example.com");
});
