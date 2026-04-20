import { assertEquals } from "@std/assert";
import { GroupManager } from "../src/groups.ts";

// --- groupEmail() tests ---

Deno.test("groupEmail: normalizes department name", () => {
  assertEquals(
    GroupManager.groupEmail("justworks", "Product Engineering", "pelotech.com"),
    "justworks-product-engineering@pelotech.com",
  );
});

Deno.test("groupEmail: removes special characters", () => {
  assertEquals(
    GroupManager.groupEmail("justworks", "R&D / Innovation", "example.com"),
    "justworks-rd--innovation@example.com".replace("--", "-"),
  );
});

Deno.test("groupEmail: handles single word department", () => {
  assertEquals(
    GroupManager.groupEmail("jw", "Engineering", "example.com"),
    "jw-engineering@example.com",
  );
});

Deno.test("groupEmail: handles multiple spaces", () => {
  assertEquals(
    GroupManager.groupEmail("jw", "Customer  Success  Team", "example.com"),
    "jw-customer-success-team@example.com",
  );
});

// --- groupDisplayName() tests ---

Deno.test("groupDisplayName: formats correctly", () => {
  assertEquals(
    GroupManager.groupDisplayName("justworks", "Product Engineering"),
    "Justworks Product Engineering",
  );
});

Deno.test("groupDisplayName: capitalizes prefix", () => {
  assertEquals(
    GroupManager.groupDisplayName("jw", "Sales"),
    "Jw Sales",
  );
});

Deno.test("groupDisplayName: preserves department casing", () => {
  assertEquals(
    GroupManager.groupDisplayName("justworks", "R&D"),
    "Justworks R&D",
  );
});
