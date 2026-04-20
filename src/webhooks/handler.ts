/** Webhook handler for Justworks events */

import type { SyncOrchestrator } from "../sync.ts";
import type { Config } from "../config.ts";
import { verifyWebhookSignature } from "./verify.ts";

export type Logger = {
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
};

const SIGNATURE_HEADER = "x-justworks-signature";
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000; // 1 hour

const SUPPORTED_EVENTS = new Set([
  "member.created.v1",
  "member.updated.v1",
  "member.terminated.v1",
]);

interface WebhookEvent {
  type: string;
  timestamp: string;
  data: {
    member_id: string;
    [key: string]: unknown;
  };
}

interface WebhookPayload {
  event: WebhookEvent;
}

/**
 * Create webhook route handler.
 * Returns a function that handles POST /webhooks/justworks.
 * Returns null for non-matching routes so the server router can continue.
 */
export function createWebhookHandler(
  syncOrchestrator: SyncOrchestrator,
  config: Config,
  logger: Logger,
): (req: Request) => Promise<Response | null> {
  // Idempotency map: "{memberId}:{eventTimestamp}" -> processed time
  const processedEvents = new Map<string, number>();

  /** Prune expired entries from the idempotency map. */
  function pruneProcessedEvents(): void {
    const now = Date.now();
    for (const [key, processedAt] of processedEvents) {
      if (now - processedAt > IDEMPOTENCY_TTL_MS) {
        processedEvents.delete(key);
      }
    }
  }

  return async (req: Request): Promise<Response | null> => {
    const url = new URL(req.url);

    if (req.method !== "POST" || url.pathname !== "/webhooks/justworks") {
      return null;
    }

    // Read raw body
    const body = new Uint8Array(await req.arrayBuffer());

    // Get signature from header
    const signature = req.headers.get(SIGNATURE_HEADER);
    if (!signature) {
      logger.warn("Webhook request missing signature header");
      return Response.json({ error: "missing signature" }, { status: 401 });
    }

    // Verify signature
    const valid = await verifyWebhookSignature(
      body,
      signature,
      config.webhookSecret,
    );
    if (!valid) {
      logger.warn("Webhook signature verification failed");
      return Response.json({ error: "invalid signature" }, { status: 401 });
    }

    // Parse body
    let payload: WebhookPayload;
    try {
      payload = JSON.parse(new TextDecoder().decode(body)) as WebhookPayload;
    } catch {
      logger.warn("Webhook payload is not valid JSON");
      return Response.json({ error: "invalid JSON" }, { status: 400 });
    }

    const event = payload.event;
    if (!event?.type || !event?.data?.member_id) {
      logger.warn("Webhook payload missing required fields", {
        hasType: !!event?.type,
        hasMemberId: !!event?.data?.member_id,
      });
      return Response.json({ error: "invalid payload" }, { status: 400 });
    }

    // Check event type
    if (!SUPPORTED_EVENTS.has(event.type)) {
      logger.info("Ignoring unsupported webhook event type", {
        type: event.type,
      });
      return Response.json({
        status: "ignored",
        reason: "unsupported event type",
      });
    }

    const memberId = event.data.member_id;
    const eventTimestamp = event.timestamp ?? "";
    const dedupeKey = `${memberId}:${eventTimestamp}`;

    // Idempotency check
    pruneProcessedEvents();
    if (processedEvents.has(dedupeKey)) {
      logger.info("Skipping duplicate webhook event", {
        dedupeKey,
        type: event.type,
      });
      return Response.json({ status: "duplicate" });
    }

    // Mark as processed immediately (before async work)
    processedEvents.set(dedupeKey, Date.now());

    logger.info("Received webhook event", {
      type: event.type,
      memberId,
      dedupeKey,
    });

    // Respond 200 immediately, process async (fire-and-forget)
    syncOrchestrator.syncMember(memberId).then((action) => {
      logger.info("Webhook sync completed", {
        type: event.type,
        memberId,
        actionType: action.type,
      });
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Webhook sync failed", {
        type: event.type,
        memberId,
        error: message,
      });
    });

    return Response.json({ status: "accepted" });
  };
}
