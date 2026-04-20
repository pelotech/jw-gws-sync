/** HTTP server using Deno.serve() with simple router */

import { logger } from "./logger.ts";

export type RouteHandler = (req: Request) => Promise<Response | null>;

export interface ServerConfig {
  port: number;
  checkReady: () => Promise<boolean> | boolean;
  routes?: RouteHandler[];
}

function handleHealthz(): Response {
  return Response.json({ status: "ok" });
}

async function handleReadyz(
  checkReady: () => Promise<boolean> | boolean,
): Promise<Response> {
  const ready = await checkReady();
  if (ready) {
    return Response.json({ status: "ready" });
  }
  return Response.json({ status: "not ready" }, { status: 503 });
}

async function route(req: Request, config: ServerConfig): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "GET" && url.pathname === "/healthz") {
    return handleHealthz();
  }

  if (req.method === "GET" && url.pathname === "/readyz") {
    return await handleReadyz(config.checkReady);
  }

  if (config.routes) {
    for (const handler of config.routes) {
      const response = await handler(req);
      if (response !== null) {
        return response;
      }
    }
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
