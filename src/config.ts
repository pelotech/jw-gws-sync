/** Load and validate environment variables into a typed Config object using Zod */

import { z } from "zod";

const nonEmptyString = z.string().min(1, "must not be empty");

const configSchema = z.object({
  // Justworks
  jwClientId: nonEmptyString,
  jwClientSecret: nonEmptyString,
  jwRedirectUri: nonEmptyString,
  jwBaseUrl: z.string().default("https://public-api.justworks.com/v1"),

  // Google
  googleServiceAccountJson: nonEmptyString,
  googleAdminEmail: nonEmptyString,
  googleDomain: nonEmptyString,
  googleCustomerId: nonEmptyString,

  // Sync
  emailDomain: nonEmptyString,
  syncIntervalMinutes: z.coerce.number().int().positive().default(60),
  dryRun: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  maxDeletesPerSync: z.coerce.number().int().positive().default(10),
  rateLimitDelayMs: z.coerce.number().int().nonnegative().default(100),
  defaultOrgUnitPath: z.string().default("/"),
  groupPrefix: z.string().default("justworks"),
  syncDepartments: z.string().default("*"),
  syncIncludeNoDepartment: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  protectedGroup: z.string().default(""),

  // Server
  webhookSecret: nonEmptyString,
  port: z.coerce.number().int().positive().max(65535).default(8080),

  // Storage
  tokenStoragePath: z.string().default("/data/jw-tokens.json"),
});

export type Config = z.infer<typeof configSchema>;

const ENV_MAP: Record<keyof z.input<typeof configSchema>, string> = {
  jwClientId: "JW_CLIENT_ID",
  jwClientSecret: "JW_CLIENT_SECRET",
  jwRedirectUri: "JW_REDIRECT_URI",
  jwBaseUrl: "JW_BASE_URL",
  googleServiceAccountJson: "GOOGLE_SERVICE_ACCOUNT_JSON",
  googleAdminEmail: "GOOGLE_ADMIN_EMAIL",
  googleDomain: "GOOGLE_DOMAIN",
  googleCustomerId: "GOOGLE_CUSTOMER_ID",
  emailDomain: "EMAIL_DOMAIN",
  syncIntervalMinutes: "SYNC_INTERVAL_MINUTES",
  dryRun: "DRY_RUN",
  maxDeletesPerSync: "MAX_DELETES_PER_SYNC",
  rateLimitDelayMs: "RATE_LIMIT_DELAY_MS",
  defaultOrgUnitPath: "DEFAULT_ORG_UNIT_PATH",
  groupPrefix: "GROUP_PREFIX",
  syncDepartments: "SYNC_DEPARTMENTS",
  syncIncludeNoDepartment: "SYNC_INCLUDE_NO_DEPARTMENT",
  protectedGroup: "PROTECTED_GROUP",
  webhookSecret: "WEBHOOK_SECRET",
  port: "PORT",
  tokenStoragePath: "TOKEN_STORAGE_PATH",
};

export function loadConfig(): Config {
  const raw: Record<string, string | undefined> = {};
  for (const [key, envName] of Object.entries(ENV_MAP)) {
    const value = Deno.env.get(envName);
    if (value !== undefined && value !== "") {
      raw[key] = value;
    }
  }

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => {
        const field = String(i.path[0]);
        const envName = ENV_MAP[field as keyof typeof ENV_MAP] ?? field;
        return `  ${envName}: ${i.message}`;
      })
      .join("\n");
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  return result.data;
}
