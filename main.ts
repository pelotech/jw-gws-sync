/** Entrypoint: Justworks -> Google Workspace sync service */

import { loadConfig } from "./src/config.ts";
import { logger } from "./src/logger.ts";
import { TokenStore } from "./src/oauth/store.ts";
import { createOAuthRoutes } from "./src/oauth/routes.ts";
import { startServer } from "./src/server.ts";
import { JustworksClient } from "./src/clients/justworks.ts";
import { GoogleWorkspaceClient } from "./src/clients/google.ts";
import { EmailGenerator } from "./src/email.ts";
import { GroupManager } from "./src/groups.ts";
import { SyncOrchestrator } from "./src/sync.ts";
import { createWebhookHandler } from "./src/webhooks/handler.ts";
import { startScheduler } from "./src/scheduler.ts";

function main(): void {
  const buildVersion = Deno.env.get("BUILD_VERSION") ?? "dev";
  logger.info("Starting jw-gws-sync", { buildVersion });

  const config = loadConfig();

  logger.info("Configuration loaded", {
    dryRun: config.dryRun,
    syncIntervalMinutes: config.syncIntervalMinutes,
    emailDomain: config.emailDomain,
    googleDomain: config.googleDomain,
    defaultOrgUnitPath: config.defaultOrgUnitPath,
    groupPrefix: config.groupPrefix,
    syncDepartments: config.syncDepartments,
    port: config.port,
  });

  // Token store for Justworks OAuth
  const tokenStore = new TokenStore(config.tokenStoragePath);

  // API clients
  const jw = new JustworksClient(config, tokenStore, logger);
  const gws = new GoogleWorkspaceClient(config, logger);

  // Sync components
  const emailGenerator = new EmailGenerator(config.emailDomain, gws, logger);
  const groupManager = new GroupManager(gws, config, logger);
  const syncOrchestrator = new SyncOrchestrator(
    jw,
    gws,
    emailGenerator,
    groupManager,
    config,
    logger,
  );

  // Route handlers
  const oauthRoutes = createOAuthRoutes(config, tokenStore);
  const webhookHandler = createWebhookHandler(syncOrchestrator, config, logger);

  // Start HTTP server
  const server = startServer({
    port: config.port,
    checkReady: () => tokenStore.hasValidTokens(),
    routes: [webhookHandler, oauthRoutes],
  });

  // Start scheduler
  const scheduler = startScheduler(
    syncOrchestrator,
    config.syncIntervalMinutes,
    logger,
    { runImmediately: true },
  );

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down gracefully...");
    scheduler.stop();
    await server.shutdown();
    logger.info("Server stopped");
  };

  Deno.addSignalListener("SIGTERM", () => {
    shutdown().catch((err) =>
      logger.error("Shutdown error", { error: String(err) })
    );
  });
  Deno.addSignalListener("SIGINT", () => {
    shutdown().catch((err) =>
      logger.error("Shutdown error", { error: String(err) })
    );
  });

  logger.info("Service started", {
    port: config.port,
    syncIntervalMinutes: config.syncIntervalMinutes,
    dryRun: config.dryRun,
  });
}

main();
