/** Token persistence for Justworks OAuth tokens */

import { logger } from "../logger.ts";

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp ms
}

const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

export class TokenStore {
  constructor(private storagePath: string) {}

  async load(): Promise<StoredTokens | null> {
    try {
      const data = await Deno.readTextFile(this.storagePath);
      const tokens = JSON.parse(data) as StoredTokens;
      if (!tokens.accessToken || !tokens.refreshToken || !tokens.expiresAt) {
        logger.warn("Token file exists but is missing required fields", {
          path: this.storagePath,
        });
        return null;
      }
      return tokens;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null;
      }
      logger.error("Failed to load tokens", {
        path: this.storagePath,
        error: String(error),
      });
      return null;
    }
  }

  async save(tokens: StoredTokens): Promise<void> {
    const dir = this.storagePath.substring(
      0,
      this.storagePath.lastIndexOf("/"),
    );
    if (dir) {
      await Deno.mkdir(dir, { recursive: true });
    }

    const tmpPath = this.storagePath + ".tmp";
    await Deno.writeTextFile(tmpPath, JSON.stringify(tokens, null, 2));
    await Deno.rename(tmpPath, this.storagePath);

    logger.info("Tokens saved", { path: this.storagePath });
  }

  async clear(): Promise<void> {
    try {
      await Deno.remove(this.storagePath);
      logger.info("Tokens cleared", { path: this.storagePath });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        logger.error("Failed to clear tokens", {
          path: this.storagePath,
          error: String(error),
        });
      }
    }
  }

  isValid(tokens: StoredTokens): boolean {
    return Date.now() < tokens.expiresAt - EXPIRY_BUFFER_MS;
  }

  async hasValidTokens(): Promise<boolean> {
    const tokens = await this.load();
    if (tokens === null) {
      return false;
    }
    return this.isValid(tokens);
  }
}
