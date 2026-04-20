/** Entrypoint: Justworks -> Google Workspace sync service */

import { loadConfig } from "./src/config.ts";
import { logger } from "./src/logger.ts";
import { TokenStore } from "./src/oauth/store.ts";
import { createOAuthRoutes } from "./src/oauth/routes.ts";
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

  const tokenStore = new TokenStore(config.tokenStoragePath);
  const oauthRoutes = createOAuthRoutes(config, tokenStore);

  const server = startServer({
    port: config.port,
    checkReady: () => tokenStore.hasValidTokens(),
    routes: [oauthRoutes],
  });

  const shutdown = async () => {
    logger.info("Shutting down gracefully...");
    await server.shutdown();
    logger.info("Server stopped");
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
