/** Google Workspace Admin Directory API client with JWT auth, retries, and pagination */

import type { Config } from "../config.ts";
import type {
  CreateUserPayload,
  GoogleGroup,
  GoogleGroupMember,
  GoogleListResponse,
  GoogleUser,
  UpdateUserPayload,
} from "../types/google.ts";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 min before expiry
const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.user",
  "https://www.googleapis.com/auth/admin.directory.group",
  "https://www.googleapis.com/auth/admin.directory.group.member",
].join(" ");

const ADMIN_BASE = "https://admin.googleapis.com/admin/directory/v1";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // Unix timestamp ms
}

/** Base64url encode a Uint8Array or string. */
function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input;
  // Use standard base64 then convert to base64url
  let b64 = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const a = bytes[i];
    const b = i + 1 < len ? bytes[i + 1] : 0;
    const c = i + 2 < len ? bytes[i + 2] : 0;
    const triplet = (a << 16) | (b << 8) | c;
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    b64 += chars[(triplet >> 18) & 0x3f];
    b64 += chars[(triplet >> 12) & 0x3f];
    b64 += i + 1 < len ? chars[(triplet >> 6) & 0x3f] : "=";
    b64 += i + 2 < len ? chars[triplet & 0x3f] : "=";
  }
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Parse PEM private key to DER ArrayBuffer. */
function pemToDer(pem: string): ArrayBuffer {
  const lines = pem.split("\n").filter((line) =>
    !line.startsWith("-----") && line.trim().length > 0
  );
  const b64 = lines.join("");
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export class GoogleWorkspaceClient {
  private cachedToken: CachedToken | null = null;

  constructor(
    private config: Config,
    private logger: {
      info: (msg: string, data?: Record<string, unknown>) => void;
      warn: (msg: string, data?: Record<string, unknown>) => void;
      error: (msg: string, data?: Record<string, unknown>) => void;
    },
  ) {}

  /**
   * Ensure we have a valid Google access token via JWT assertion flow.
   * 1. Parse service account JSON
   * 2. Build and sign JWT with RS256
   * 3. Exchange JWT for access token
   * 4. Cache with expiry
   */
  private async ensureToken(): Promise<string> {
    if (
      this.cachedToken &&
      Date.now() < this.cachedToken.expiresAt - TOKEN_EXPIRY_BUFFER_MS
    ) {
      return this.cachedToken.accessToken;
    }

    const sa = JSON.parse(
      this.config.googleServiceAccountJson,
    ) as ServiceAccountKey;

    // Build JWT
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const payload = {
      iss: sa.client_email,
      sub: this.config.googleAdminEmail,
      scope: SCOPES,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600, // 1 hour
    };

    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(payload));
    const unsignedToken = `${headerB64}.${payloadB64}`;

    // Import private key and sign
    const der = pemToDer(sa.private_key);
    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signatureBytes = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      new TextEncoder().encode(unsignedToken),
    );
    const signatureB64 = base64url(new Uint8Array(signatureBytes));
    const jwt = `${unsignedToken}.${signatureB64}`;

    // Exchange JWT for access token
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    });

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error("Google token exchange failed", {
        status: response.status,
        body: text,
      });
      throw new Error(
        `Google token exchange failed: ${response.status} ${text}`,
      );
    }

    const tokenData = await response.json() as {
      access_token: string;
      expires_in: number;
    };

    this.cachedToken = {
      accessToken: tokenData.access_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
    };

    this.logger.info("Google access token obtained", {
      expiresIn: tokenData.expires_in,
    });

    return this.cachedToken.accessToken;
  }

  /** Generic API request with auth, retry, and rate limiting. */
  private async apiRequest<T>(
    url: string,
    options?: RequestInit,
  ): Promise<T | null> {
    const token = await this.ensureToken();

    // Rate limit delay
    if (this.config.rateLimitDelayMs > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.config.rateLimitDelayMs)
      );
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json",
          "Content-Type": "application/json",
          ...options?.headers,
        },
      });

      if (response.ok) {
        // Some DELETE responses may have no body
        const text = await response.text();
        if (text.length === 0) {
          return null;
        }
        return JSON.parse(text) as T;
      }

      // 404 is not retryable — let caller handle it
      if (response.status === 404) {
        await response.text(); // consume body
        return null;
      }

      const isRetryable = response.status === 429 || response.status >= 500;
      if (!isRetryable || attempt === MAX_RETRIES) {
        const text = await response.text();
        throw new Error(
          `Google API error: ${response.status} ${response.statusText} — ${text}`,
        );
      }

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

      this.logger.warn("Retrying Google API request", {
        url,
        status: response.status,
        attempt: attempt + 1,
        delayMs,
      });

      await response.text(); // consume body
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error("Exhausted retries");
  }

  // === User methods ===

  /** List all users in the domain, handling pagination. */
  async listUsers(): Promise<GoogleUser[]> {
    const users: GoogleUser[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        customer: this.config.googleCustomerId,
        maxResults: "500",
      });
      if (pageToken) {
        params.set("pageToken", pageToken);
      }

      const response = await this.apiRequest<GoogleListResponse<GoogleUser>>(
        `${ADMIN_BASE}/users?${params.toString()}`,
      );

      if (response?.users) {
        users.push(...response.users);
      }
      pageToken = response?.nextPageToken;

      this.logger.info("Fetched Google users page", {
        count: response?.users?.length ?? 0,
        total: users.length,
        hasMore: pageToken !== undefined,
      });
    } while (pageToken);

    return users;
  }

  /** Get a single user by email. Returns null if not found. */
  async getUser(email: string): Promise<GoogleUser | null> {
    return await this.apiRequest<GoogleUser>(
      `${ADMIN_BASE}/users/${encodeURIComponent(email)}`,
    );
  }

  /** Create a new user. */
  async createUser(payload: CreateUserPayload): Promise<GoogleUser> {
    const result = await this.apiRequest<GoogleUser>(
      `${ADMIN_BASE}/users`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
    if (result === null) {
      throw new Error("Failed to create user: empty response");
    }
    return result;
  }

  /** Update a user (PATCH). */
  async updateUser(
    email: string,
    payload: UpdateUserPayload,
  ): Promise<GoogleUser> {
    const result = await this.apiRequest<GoogleUser>(
      `${ADMIN_BASE}/users/${encodeURIComponent(email)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );
    if (result === null) {
      throw new Error(`Failed to update user ${email}: empty response`);
    }
    return result;
  }

  /** Suspend a user. */
  async suspendUser(email: string): Promise<void> {
    await this.updateUser(email, { suspended: true });
  }

  // === Group methods ===

  /** List all groups in the domain, handling pagination. */
  async listGroups(): Promise<GoogleGroup[]> {
    const groups: GoogleGroup[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        customer: this.config.googleCustomerId,
        maxResults: "200",
      });
      if (pageToken) {
        params.set("pageToken", pageToken);
      }

      const response = await this.apiRequest<GoogleListResponse<GoogleGroup>>(
        `${ADMIN_BASE}/groups?${params.toString()}`,
      );

      if (response?.groups) {
        groups.push(...response.groups);
      }
      pageToken = response?.nextPageToken;

      this.logger.info("Fetched Google groups page", {
        count: response?.groups?.length ?? 0,
        total: groups.length,
        hasMore: pageToken !== undefined,
      });
    } while (pageToken);

    return groups;
  }

  /** Create a group. */
  async createGroup(
    group: { email: string; name: string; description: string },
  ): Promise<GoogleGroup> {
    const result = await this.apiRequest<GoogleGroup>(
      `${ADMIN_BASE}/groups`,
      {
        method: "POST",
        body: JSON.stringify(group),
      },
    );
    if (result === null) {
      throw new Error("Failed to create group: empty response");
    }
    return result;
  }

  /** Delete a group. */
  async deleteGroup(groupKey: string): Promise<void> {
    await this.apiRequest<unknown>(
      `${ADMIN_BASE}/groups/${encodeURIComponent(groupKey)}`,
      { method: "DELETE" },
    );
  }

  /** List members of a group, handling pagination. */
  async listGroupMembers(groupKey: string): Promise<GoogleGroupMember[]> {
    const members: GoogleGroupMember[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams();
      if (pageToken) {
        params.set("pageToken", pageToken);
      }

      const query = params.toString();
      const url = `${ADMIN_BASE}/groups/${
        encodeURIComponent(groupKey)
      }/members${query ? `?${query}` : ""}`;

      const response = await this.apiRequest<
        GoogleListResponse<GoogleGroupMember>
      >(url);

      if (response?.members) {
        members.push(...response.members);
      }
      pageToken = response?.nextPageToken;
    } while (pageToken);

    return members;
  }

  /** Add a member to a group. */
  async addGroupMember(groupKey: string, email: string): Promise<void> {
    await this.apiRequest<unknown>(
      `${ADMIN_BASE}/groups/${encodeURIComponent(groupKey)}/members`,
      {
        method: "POST",
        body: JSON.stringify({ email, role: "MEMBER" }),
      },
    );
  }

  /** Remove a member from a group. */
  async removeGroupMember(groupKey: string, email: string): Promise<void> {
    await this.apiRequest<unknown>(
      `${ADMIN_BASE}/groups/${encodeURIComponent(groupKey)}/members/${
        encodeURIComponent(email)
      }`,
      { method: "DELETE" },
    );
  }
}
