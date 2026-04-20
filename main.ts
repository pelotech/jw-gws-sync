/** Entrypoint: Justworks -> Google Workspace sync service */

import { loadConfig } from "./src/config.ts";
import { logger } from "./src/logger.ts";
import { startServer } from "./src/server.ts";

function main(): void {
  const config = loadConfig();

  logger.info("Configuration loaded", {
    dryRun: config.dryRun,
    syncIntervalMinutes: config.syncIntervalMinutes,
    emailDomain: config.emailDomain,
    googleDomain: config.googleDomain,
    defaultOrgUnitPath: config.defaultOrgUnitPath,
    groupPrefix: config.groupPrefix,
  });

  const server = startServer({
    port: config.port,
    checkReady: () => {
      // Phase 1: always ready (token check comes in Phase 2)
      return true;
    },
  });

  const shutdown = async () => {
    logger.info("Shutting down gracefully...");
    await server.shutdown();
    logger.info("Server stopped");
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGTERM", () => {
    shutdown();
  });
  Deno.addSignalListener("SIGINT", () => {
    shutdown();
  });

  logger.info("Service started", { port: config.port });
}

main();
