/** Justworks API client with token management, retries, and pagination */

import type { Config } from "../config.ts";
import type { TokenStore } from "../oauth/store.ts";
import type {
  JustworksListResponse,
  JustworksMember,
  JustworksTokenResponse,
} from "../types/justworks.ts";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

export class JustworksClient {
  constructor(
    private config: Config,
    private tokenStore: TokenStore,
    private logger: {
      info: (msg: string, data?: Record<string, unknown>) => void;
      warn: (msg: string, data?: Record<string, unknown>) => void;
      error: (msg: string, data?: Record<string, unknown>) => void;
    },
  ) {}

  /** Ensure we have a valid access token. Refreshes if expired. */
  private async ensureToken(): Promise<string> {
    const tokens = await this.tokenStore.load();
    if (tokens === null) {
      throw new Error(
        "No tokens available — OAuth flow has not been completed",
      );
    }

    if (this.tokenStore.isValid(tokens)) {
      return tokens.accessToken;
    }

    this.logger.info("Access token expired, refreshing");
    await this.refreshToken(tokens.refreshToken);

    const refreshed = await this.tokenStore.load();
    if (refreshed === null) {
      throw new Error("Token store empty after refresh");
    }
    return refreshed.accessToken;
  }

  /** Refresh the access token using the refresh token. */
  private async refreshToken(refreshToken: string): Promise<void> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.config.jwClientId,
      client_secret: this.config.jwClientSecret,
      refresh_token: refreshToken,
    });

    const tokenUrl = this.config.jwBaseUrl.replace(/\/v1$/, "") +
      "/oauth/token";
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error("Token refresh failed", {
        status: response.status,
        body: text,
      });
      throw new Error(`Token refresh failed: ${response.status} ${text}`);
    }

    const data = await response.json() as JustworksTokenResponse;

    await this.tokenStore.save({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    });

    this.logger.info("Token refreshed successfully");
  }

  /** Generic fetch wrapper with auth header, retries on 429/5xx, and exponential backoff. */
  private async apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.config.jwBaseUrl}${path}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const token = await this.ensureToken();
      const response = await fetch(url, {
        ...options,
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json",
          ...options?.headers,
        },
      });

      if (response.ok) {
        return await response.json() as T;
      }

      const isRetryable = response.status === 429 || response.status >= 500;
      if (!isRetryable || attempt === MAX_RETRIES) {
        const text = await response.text();
        throw new Error(
          `Justworks API error: ${response.status} ${response.statusText} — ${text}`,
        );
      }

      // Determine backoff delay
      let delayMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        if (retryAfter) {
          const retryAfterMs = parseInt(retryAfter, 10) * 1000;
          if (!isNaN(retryAfterMs) && retryAfterMs > 0) {
            delayMs = retryAfterMs;
          }
        }
      }

      this.logger.warn("Retrying Justworks API request", {
        path,
        status: response.status,
        attempt: attempt + 1,
        delayMs,
      });

      // Consume body to free connection
      await response.text();
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    // Unreachable, but satisfies the compiler
    throw new Error("Exhausted retries");
  }

  /** List all active members, handling pagination via next_cursor. */
  async listActiveMembers(): Promise<JustworksMember[]> {
    const members: JustworksMember[] = [];
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({ employment_status: "ACTIVE" });
      if (cursor) {
        params.set("cursor", cursor);
      }

      const response = await this.apiRequest<
        JustworksListResponse<JustworksMember>
      >(
        `/members?${params.toString()}`,
      );

      members.push(...response.data);
      cursor = response.pagination.next_cursor;

      this.logger.info("Fetched members page", {
        count: response.data.length,
        total: members.length,
        hasMore: cursor !== undefined,
      });
    } while (cursor);

    return members;
  }

  /** Get a single member by ID. */
  async getMember(id: string): Promise<JustworksMember> {
    return await this.apiRequest<JustworksMember>(`/members/${id}`);
  }
}
