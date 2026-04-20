/** OAuth routes for Justworks authorization flow and admin page */

import type { Config } from "../config.ts";
import { logger } from "../logger.ts";
import type { TokenStore } from "./store.ts";

const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const pendingStates = new Map<string, number>();

function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  // Cleanup expired states before adding a new one
  const now = Date.now();
  for (const [s, exp] of pendingStates) {
    if (now > exp) pendingStates.delete(s);
  }
  pendingStates.set(state, now + STATE_EXPIRY_MS);
  return state;
}

function adminPageHtml(query: URLSearchParams): string {
  const successMsg = query.get("success") ?? "";
  const errorMsg = query.get("error") ?? "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Justworks OAuth - Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; color: #333; padding: 2rem; }
    .container { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 8px; padding: 2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h1 { font-size: 1.25rem; margin-bottom: 1.5rem; }
    .status { padding: 1rem; border-radius: 6px; margin-bottom: 1rem; }
    .status.connected { background: #e6f9e6; border: 1px solid #4caf50; }
    .status.disconnected { background: #fce4e4; border: 1px solid #e53935; }
    .label { font-weight: 600; font-size: 0.9rem; }
    .detail { font-size: 0.85rem; color: #555; margin-top: 0.25rem; }
    .msg { padding: 0.75rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.9rem; }
    .msg.success { background: #e6f9e6; border: 1px solid #4caf50; }
    .msg.error { background: #fce4e4; border: 1px solid #e53935; }
    .btn { display: inline-block; padding: 0.6rem 1.2rem; border: none; border-radius: 6px; font-size: 0.9rem; cursor: pointer; text-decoration: none; color: #fff; }
    .btn-connect { background: #1976d2; }
    .btn-connect:hover { background: #1565c0; }
    .btn-disconnect { background: #e53935; }
    .btn-disconnect:hover { background: #c62828; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Justworks OAuth</h1>
    ${
    successMsg ? `<div class="msg success">${escapeHtml(successMsg)}</div>` : ""
  }
    ${errorMsg ? `<div class="msg error">${escapeHtml(errorMsg)}</div>` : ""}
    <div id="status" class="status disconnected">
      <div class="label">Loading...</div>
    </div>
    <div id="actions"></div>
  </div>
  <script>
    async function refresh() {
      try {
        const res = await fetch("/oauth/status");
        const data = await res.json();
        const el = document.getElementById("status");
        const actions = document.getElementById("actions");
        if (data.connected) {
          const exp = new Date(data.expiresAt).toLocaleString();
          const mins = Math.round(data.expiresIn / 60);
          el.className = "status connected";
          while (el.firstChild) el.removeChild(el.firstChild);
          const lbl = document.createElement("div");
          lbl.className = "label";
          lbl.textContent = "Connected";
          el.appendChild(lbl);
          const det = document.createElement("div");
          det.className = "detail";
          det.textContent = "Expires: " + exp + " (" + mins + " min)";
          el.appendChild(det);
          while (actions.firstChild) actions.removeChild(actions.firstChild);
          const form = document.createElement("form");
          form.method = "POST";
          form.action = "/oauth/disconnect";
          form.style.display = "inline";
          const btn = document.createElement("button");
          btn.type = "submit";
          btn.className = "btn btn-disconnect";
          btn.textContent = "Disconnect";
          form.appendChild(btn);
          actions.appendChild(form);
        } else {
          el.className = "status disconnected";
          while (el.firstChild) el.removeChild(el.firstChild);
          const lbl = document.createElement("div");
          lbl.className = "label";
          lbl.textContent = "Disconnected";
          el.appendChild(lbl);
          const det = document.createElement("div");
          det.className = "detail";
          det.textContent = "No valid tokens";
          el.appendChild(det);
          while (actions.firstChild) actions.removeChild(actions.firstChild);
          const btn = document.createElement("a");
          btn.className = "btn btn-connect";
          btn.href = "/oauth/authorize";
          btn.textContent = "Connect to Justworks";
          actions.appendChild(btn);
        }
      } catch (_) {
        // ignore fetch errors
      }
    }
    refresh();
    setInterval(refresh, 30000);
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function handleCallback(
  url: URL,
  config: Config,
  tokenStore: TokenStore,
): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    logger.error("OAuth callback received error", { error: errorParam });
    return Response.redirect(
      new URL(`/oauth?error=${encodeURIComponent(errorParam)}`, url.origin)
        .toString(),
      302,
    );
  }

  const stateExpiry = state ? pendingStates.get(state) : undefined;
  if (!state || stateExpiry === undefined || Date.now() > stateExpiry) {
    logger.error("OAuth callback state mismatch or expired", {
      received: state ?? "none",
    });
    if (state) pendingStates.delete(state);
    return Response.redirect(
      new URL("/oauth?error=Invalid+state+parameter", url.origin).toString(),
      302,
    );
  }
  pendingStates.delete(state);

  if (!code) {
    return Response.redirect(
      new URL("/oauth?error=Missing+authorization+code", url.origin).toString(),
      302,
    );
  }

  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.jwClientId,
      client_secret: config.jwClientSecret,
      redirect_uri: config.jwRedirectUri,
      code,
    });

    const tokenUrl = "https://public-api.justworks.com/oauth/token";
    logger.info("Exchanging authorization code for tokens", { tokenUrl });

    const resp = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.error("Token exchange failed", {
        status: resp.status,
        body: text,
      });
      return Response.redirect(
        new URL(
          `/oauth?error=${
            encodeURIComponent("Token exchange failed: " + resp.status)
          }`,
          url.origin,
        ).toString(),
        302,
      );
    }

    const data = await resp.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    await tokenStore.save({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    });

    logger.info("OAuth tokens obtained successfully");
    return Response.redirect(
      new URL("/oauth?success=Connected+successfully", url.origin).toString(),
      302,
    );
  } catch (error) {
    logger.error("OAuth callback error", { error: String(error) });
    return Response.redirect(
      new URL(
        `/oauth?error=${
          encodeURIComponent("Unexpected error during token exchange")
        }`,
        url.origin,
      ).toString(),
      302,
    );
  }
}

async function handleStatus(
  tokenStore: TokenStore,
): Promise<Response> {
  const tokens = await tokenStore.load();
  if (tokens === null || !tokenStore.isValid(tokens)) {
    return Response.json({ connected: false });
  }
  const expiresIn = Math.max(
    0,
    Math.round((tokens.expiresAt - Date.now()) / 1000),
  );
  return Response.json({
    connected: true,
    expiresAt: new Date(tokens.expiresAt).toISOString(),
    expiresIn,
  });
}

export function createOAuthRoutes(
  config: Config,
  tokenStore: TokenStore,
): (req: Request) => Promise<Response | null> {
  return async (req: Request): Promise<Response | null> => {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/oauth") {
      return new Response(adminPageHtml(url.searchParams), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (req.method === "GET" && url.pathname === "/oauth/authorize") {
      const state = generateState();
      const authUrl =
        `https://payroll.justworks.com/oauth/authorize?client_id=${
          encodeURIComponent(config.jwClientId)
        }&redirect_uri=${
          encodeURIComponent(config.jwRedirectUri)
        }&response_type=code&state=${state}`;
      logger.info("Redirecting to Justworks authorization", { authUrl });
      return Response.redirect(authUrl, 302);
    }

    if (req.method === "GET" && url.pathname === "/oauth/callback") {
      return await handleCallback(url, config, tokenStore);
    }

    if (req.method === "GET" && url.pathname === "/oauth/status") {
      return await handleStatus(tokenStore);
    }

    if (req.method === "POST" && url.pathname === "/oauth/disconnect") {
      await tokenStore.clear();
      logger.info("OAuth tokens disconnected by admin");
      return Response.redirect(
        new URL("/oauth?success=Disconnected+successfully", url.origin)
          .toString(),
        302,
      );
    }

    return null;
  };
}
