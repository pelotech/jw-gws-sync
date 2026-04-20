/** Load and validate environment variables into a typed Config object */

export interface Config {
  // Justworks
  jwClientId: string;
  jwClientSecret: string;
  jwRedirectUri: string;
  jwBaseUrl: string;

  // Google
  googleServiceAccountJson: string;
  googleAdminEmail: string;
  googleDomain: string;
  googleCustomerId: string;

  // Sync
  emailDomain: string;
  syncIntervalMinutes: number;
  dryRun: boolean;
  maxDeletesPerSync: number;
  rateLimitDelayMs: number;
  defaultOrgUnitPath: string;
  groupPrefix: string;
  syncDepartments: string;
  syncIncludeNoDepartment: boolean;
  protectedGroup: string;

  // Server
  webhookSecret: string;
  port: number;

  // Storage
  tokenStoragePath: string;
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === "") {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === "") {
    return defaultValue;
  }
  return value;
}

export function loadConfig(): Config {
  const syncIntervalMinutes = parseInt(optionalEnv("SYNC_INTERVAL_MINUTES", "60"), 10);
  if (isNaN(syncIntervalMinutes)) {
    throw new Error("SYNC_INTERVAL_MINUTES must be a valid number");
  }

  const maxDeletesPerSync = parseInt(optionalEnv("MAX_DELETES_PER_SYNC", "10"), 10);
  if (isNaN(maxDeletesPerSync)) {
    throw new Error("MAX_DELETES_PER_SYNC must be a valid number");
  }

  const rateLimitDelayMs = parseInt(optionalEnv("RATE_LIMIT_DELAY_MS", "100"), 10);
  if (isNaN(rateLimitDelayMs)) {
    throw new Error("RATE_LIMIT_DELAY_MS must be a valid number");
  }

  const port = parseInt(optionalEnv("PORT", "8080"), 10);
  if (isNaN(port)) {
    throw new Error("PORT must be a valid number");
  }

  return {
    // Justworks
    jwClientId: requireEnv("JW_CLIENT_ID"),
    jwClientSecret: requireEnv("JW_CLIENT_SECRET"),
    jwRedirectUri: requireEnv("JW_REDIRECT_URI"),
    jwBaseUrl: optionalEnv("JW_BASE_URL", "https://public-api.justworks.com/v1"),

    // Google
    googleServiceAccountJson: requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON"),
    googleAdminEmail: requireEnv("GOOGLE_ADMIN_EMAIL"),
    googleDomain: requireEnv("GOOGLE_DOMAIN"),
    googleCustomerId: requireEnv("GOOGLE_CUSTOMER_ID"),

    // Sync
    emailDomain: requireEnv("EMAIL_DOMAIN"),
    syncIntervalMinutes,
    dryRun: optionalEnv("DRY_RUN", "false") === "true",
    maxDeletesPerSync,
    rateLimitDelayMs,
    defaultOrgUnitPath: optionalEnv("DEFAULT_ORG_UNIT_PATH", "/"),
    groupPrefix: optionalEnv("GROUP_PREFIX", "justworks"),
    syncDepartments: optionalEnv("SYNC_DEPARTMENTS", "*"),
    syncIncludeNoDepartment: optionalEnv("SYNC_INCLUDE_NO_DEPARTMENT", "true") === "true",
    protectedGroup: optionalEnv("PROTECTED_GROUP", ""),

    // Server
    webhookSecret: requireEnv("WEBHOOK_SECRET"),
    port,

    // Storage
    tokenStoragePath: optionalEnv("TOKEN_STORAGE_PATH", "/data/jw-tokens.json"),
  };
}
