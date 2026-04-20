/** Cron scheduler for periodic full syncs */

import type { SyncOrchestrator } from "./sync.ts";

export type Logger = {
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
};

export interface SchedulerHandle {
  stop: () => void;
}

/**
 * Start a periodic full sync scheduler.
 *
 * - Uses setInterval with the configured interval
 * - Includes a lock flag to prevent overlapping syncs
 * - Catches all errors (never crashes the process)
 * - Optionally runs an immediate first sync on startup
 * - Returns a stop() handle to clear the interval
 */
export function startScheduler(
  syncOrchestrator: SyncOrchestrator,
  intervalMinutes: number,
  logger: Logger,
  options: { runImmediately?: boolean } = { runImmediately: true },
): SchedulerHandle {
  let syncing = false;

  async function runSync(): Promise<void> {
    if (syncing) {
      logger.warn("Skipping scheduled sync: previous sync still running");
      return;
    }

    syncing = true;
    const startTime = Date.now();
    logger.info("Scheduled sync starting");

    try {
      const result = await syncOrchestrator.fullSync();
      const durationMs = Date.now() - startTime;
      logger.info("Scheduled sync completed", {
        durationMs,
        created: result.summary.created,
        updated: result.summary.updated,
        suspended: result.summary.suspended,
        skipped: result.summary.skipped,
        unchanged: result.summary.unchanged,
        errored: result.summary.errored,
        dryRun: result.dryRun,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startTime;
      logger.error("Scheduled sync failed", { error: message, durationMs });
    } finally {
      syncing = false;
    }
  }

  // Run immediately if configured
  if (options.runImmediately !== false) {
    runSync().catch(() => {}); // errors already logged inside runSync
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  const intervalId = setInterval(runSync, intervalMs);

  logger.info("Scheduler started", {
    intervalMinutes,
    intervalMs,
    runImmediately: options.runImmediately !== false,
  });

  return {
    stop: () => {
      clearInterval(intervalId);
      logger.info("Scheduler stopped");
    },
  };
}
