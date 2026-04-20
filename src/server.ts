/** HTTP server using Deno.serve() with simple router */

import { logger } from "./logger.ts";

export interface ServerConfig {
  port: number;
  checkReady: () => boolean;
}

function handleHealthz(): Response {
  return Response.json({ status: "ok" });
}

function handleReadyz(checkReady: () => boolean): Response {
  if (checkReady()) {
    return Response.json({ status: "ready" });
  }
  return Response.json({ status: "not ready" }, { status: 503 });
}

function route(req: Request, config: ServerConfig): Response {
  const url = new URL(req.url);

  if (req.method === "GET" && url.pathname === "/healthz") {
    return handleHealthz();
  }

  if (req.method === "GET" && url.pathname === "/readyz") {
    return handleReadyz(config.checkReady);
  }

  return Response.json({ error: "not found" }, { status: 404 });
}

export function startServer(config: ServerConfig): Deno.HttpServer {
  const server = Deno.serve(
    { port: config.port, onListen: () => {} },
    (req) => route(req, config),
  );

  logger.info("Server started", { port: config.port });
  return server;
}
