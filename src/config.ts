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
    syncIntervalMinutes: parseInt(optionalEnv("SYNC_INTERVAL_MINUTES", "60"), 10),
    dryRun: optionalEnv("DRY_RUN", "false") === "true",
    maxDeletesPerSync: parseInt(optionalEnv("MAX_DELETES_PER_SYNC", "10"), 10),
    rateLimitDelayMs: parseInt(optionalEnv("RATE_LIMIT_DELAY_MS", "100"), 10),
    defaultOrgUnitPath: optionalEnv("DEFAULT_ORG_UNIT_PATH", "/"),
    groupPrefix: optionalEnv("GROUP_PREFIX", "justworks"),
    syncDepartments: optionalEnv("SYNC_DEPARTMENTS", "*"),
    syncIncludeNoDepartment: optionalEnv("SYNC_INCLUDE_NO_DEPARTMENT", "true") === "true",
    protectedGroup: optionalEnv("PROTECTED_GROUP", ""),

    // Server
    webhookSecret: requireEnv("WEBHOOK_SECRET"),
    port: parseInt(optionalEnv("PORT", "8080"), 10),

    // Storage
    tokenStoragePath: optionalEnv("TOKEN_STORAGE_PATH", "/data/jw-tokens.json"),
  };
}
