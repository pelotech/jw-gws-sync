import { assertEquals } from "@std/assert";
import { verifyWebhookSignature } from "../src/webhooks/verify.ts";
import { createWebhookHandler } from "../src/webhooks/handler.ts";
import type { SyncOrchestrator } from "../src/sync.ts";
import type { Config } from "../src/config.ts";

// --- Helpers ---

const encoder = new TextEncoder();

/** Compute HMAC-SHA256 and return hex string. */
async function computeHmac(
  payload: Uint8Array,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, payload);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    jwClientId: "test",
    jwClientSecret: "test",
    jwRedirectUri: "http://localhost/callback",
    jwBaseUrl: "https://api.test.com/v1",
    googleServiceAccountJson: "{}",
    googleAdminEmail: "admin@test.com",
    googleDomain: "test.com",
    googleCustomerId: "C123",
    emailDomain: "test.com",
    syncIntervalMinutes: 60,
    dryRun: false,
    maxDeletesPerSync: 10,
    rateLimitDelayMs: 0,
    defaultOrgUnitPath: "/",
    groupPrefix: "justworks",
    syncDepartments: "*",
    syncIncludeNoDepartment: true,
    protectedGroup: "",
    webhookSecret: "test-secret-123",
    port: 8080,
    tokenStoragePath: "/tmp/tokens.json",
    ...overrides,
  };
}

// --- verifyWebhookSignature tests ---

Deno.test("verifyWebhookSignature: accepts valid signature", async () => {
  const secret = "my-webhook-secret";
  const payload = encoder.encode('{"event":"test"}');
  const signature = await computeHmac(payload, secret);

  const result = await verifyWebhookSignature(payload, signature, secret);
  assertEquals(result, true);
});

Deno.test("verifyWebhookSignature: rejects wrong signature", async () => {
  const secret = "my-webhook-secret";
  const payload = encoder.encode('{"event":"test"}');

  // Compute with wrong secret
  const wrongSignature = await computeHmac(payload, "wrong-secret");

  const result = await verifyWebhookSignature(payload, wrongSignature, secret);
  assertEquals(result, false);
});

Deno.test("verifyWebhookSignature: rejects tampered payload", async () => {
  const secret = "my-webhook-secret";
  const originalPayload = encoder.encode('{"event":"test"}');
  const signature = await computeHmac(originalPayload, secret);

  // Tamper with the payload
  const tamperedPayload = encoder.encode('{"event":"hacked"}');

  const result = await verifyWebhookSignature(
    tamperedPayload,
    signature,
    secret,
  );
  assertEquals(result, false);
});

Deno.test("verifyWebhookSignature: rejects malformed hex signature", async () => {
  const secret = "my-webhook-secret";
  const payload = encoder.encode('{"event":"test"}');

  const result = await verifyWebhookSignature(payload, "not-valid-hex", secret);
  assertEquals(result, false);
});

Deno.test("verifyWebhookSignature: rejects empty signature", async () => {
  const secret = "my-webhook-secret";
  const payload = encoder.encode('{"event":"test"}');

  const result = await verifyWebhookSignature(payload, "", secret);
  assertEquals(result, false);
});

// --- Webhook handler idempotency tests ---

Deno.test("webhook handler: deduplicates identical events", async () => {
  let syncCallCount = 0;

  const stubOrchestrator = {
    syncMember: (_id: string) => {
      syncCallCount++;
      return Promise.resolve({
        type: "NO_CHANGE" as const,
        email: "test@test.com",
      });
    },
  } as unknown as SyncOrchestrator;

  const config = makeConfig();
  const handler = createWebhookHandler(stubOrchestrator, config, noopLogger);

  const eventPayload = JSON.stringify({
    event: {
      type: "member.updated.v1",
      timestamp: "2025-01-01T00:00:00Z",
      data: { member_id: "jw-001" },
    },
  });
  const payloadBytes = encoder.encode(eventPayload);
  const signature = await computeHmac(payloadBytes, config.webhookSecret);

  // First request
  const req1 = new Request("http://localhost/webhooks/justworks", {
    method: "POST",
    body: payloadBytes,
    headers: { "x-justworks-signature": signature },
  });
  const resp1 = await handler(req1);
  assertEquals(resp1?.status, 200);
  const body1 = await resp1!.json();
  assertEquals(body1.status, "accepted");

  // Allow fire-and-forget to start
  await new Promise((r) => setTimeout(r, 50));

  // Second request (duplicate)
  const req2 = new Request("http://localhost/webhooks/justworks", {
    method: "POST",
    body: payloadBytes,
    headers: { "x-justworks-signature": signature },
  });
  const resp2 = await handler(req2);
  assertEquals(resp2?.status, 200);
  const body2 = await resp2!.json();
  assertEquals(body2.status, "duplicate");

  // Wait for async processing
  await new Promise((r) => setTimeout(r, 100));

  // syncMember should have been called only once
  assertEquals(syncCallCount, 1);
});

Deno.test("webhook handler: returns null for non-matching routes", async () => {
  const stubOrchestrator = {
    syncMember: () =>
      Promise.resolve({ type: "NO_CHANGE" as const, email: "" }),
  } as unknown as SyncOrchestrator;

  const config = makeConfig();
  const handler = createWebhookHandler(stubOrchestrator, config, noopLogger);

  // GET request
  const req1 = new Request("http://localhost/webhooks/justworks", {
    method: "GET",
  });
  const resp1 = await handler(req1);
  assertEquals(resp1, null);

  // Wrong path
  const req2 = new Request("http://localhost/other", {
    method: "POST",
    body: "{}",
  });
  const resp2 = await handler(req2);
  assertEquals(resp2, null);
});

Deno.test("webhook handler: returns 401 for missing signature", async () => {
  const stubOrchestrator = {
    syncMember: () =>
      Promise.resolve({ type: "NO_CHANGE" as const, email: "" }),
  } as unknown as SyncOrchestrator;

  const config = makeConfig();
  const handler = createWebhookHandler(stubOrchestrator, config, noopLogger);

  const req = new Request("http://localhost/webhooks/justworks", {
    method: "POST",
    body: "{}",
  });
  const resp = await handler(req);
  assertEquals(resp?.status, 401);
});

Deno.test("webhook handler: returns 401 for invalid signature", async () => {
  const stubOrchestrator = {
    syncMember: () =>
      Promise.resolve({ type: "NO_CHANGE" as const, email: "" }),
  } as unknown as SyncOrchestrator;

  const config = makeConfig();
  const handler = createWebhookHandler(stubOrchestrator, config, noopLogger);

  const req = new Request("http://localhost/webhooks/justworks", {
    method: "POST",
    body: "{}",
    headers: {
      "x-justworks-signature":
        "0000000000000000000000000000000000000000000000000000000000000000",
    },
  });
  const resp = await handler(req);
  assertEquals(resp?.status, 401);
});
