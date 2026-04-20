# Configuration reference

All configuration is provided via environment variables. They are loaded and
validated at startup by a Zod schema (`src/config.ts`). Missing required
variables cause the service to exit with a clear error listing every problem.

Set them via the Kubernetes Secret (`jw-gws-sync-secrets`) or the chart's
`values.yaml` → `env:` map.

## Required

| Variable                      | Purpose                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `JW_CLIENT_ID`                | Justworks OAuth client ID                                                                                                      |
| `JW_CLIENT_SECRET`            | Justworks OAuth client secret                                                                                                  |
| `JW_REDIRECT_URI`             | OAuth callback URL — must match the app's redirect URI and the ingress host, e.g. `https://jw-sync.example.com/oauth/callback` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full service-account key JSON (including newlines)                                                                             |
| `GOOGLE_ADMIN_EMAIL`          | Workspace admin the service impersonates via domain-wide delegation                                                            |
| `GOOGLE_DOMAIN`               | Primary Workspace domain (e.g. `example.com`)                                                                                  |
| `GOOGLE_CUSTOMER_ID`          | Workspace customer ID (found in Admin console → Account settings)                                                              |
| `EMAIL_DOMAIN`                | Domain used when generating emails for new users (usually equal to `GOOGLE_DOMAIN`)                                            |
| `WEBHOOK_SECRET`              | HMAC-SHA256 secret shared with Justworks for webhook signature verification                                                    |

## Optional (with defaults)

| Variable                     | Default                               | Purpose                                                                         |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| `JW_BASE_URL`                | `https://public-api.justworks.com/v1` | Justworks API base URL; override for staging                                    |
| `SYNC_INTERVAL_MINUTES`      | `60`                                  | How often the scheduled full sync runs                                          |
| `DRY_RUN`                    | `false`                               | If `"true"`, log planned actions without calling Google mutations               |
| `MAX_DELETES_PER_SYNC`       | `10`                                  | Circuit breaker: if planned suspensions exceed this, abort without writing      |
| `RATE_LIMIT_DELAY_MS`        | `100`                                 | Delay between Google API calls to stay under quotas                             |
| `DEFAULT_ORG_UNIT_PATH`      | `/`                                   | Default OU path for newly created Google users                                  |
| `GROUP_PREFIX`               | `justworks`                           | Prefix for auto-managed department Google Groups (e.g. `justworks-engineering`) |
| `SYNC_DEPARTMENTS`           | `*`                                   | Comma-separated allowlist of Justworks departments to sync; `*` means all       |
| `SYNC_INCLUDE_NO_DEPARTMENT` | `true`                                | When a department allowlist is set, also include members who have no department |
| `PROTECTED_GROUP`            | _(empty)_                             | Email of a Google Group whose members are exempt from suspension                |
| `PORT`                       | `8080`                                | HTTP listen port                                                                |
| `TOKEN_STORAGE_PATH`         | `/data/jw-tokens.json`                | File path where Justworks OAuth tokens are persisted                            |

## Informational

| Variable        | Default | Purpose                                                                                                                                 |
| --------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `BUILD_VERSION` | `dev`   | Injected by the Docker build (`--build-arg BUILD_VERSION=...`) and logged at startup. Not validated; safe to omit when running locally. |

## Notes

- **`DRY_RUN` and `SYNC_INCLUDE_NO_DEPARTMENT`** are string enums validated as
  `"true"` or `"false"` (not `1`/`0` or `yes`/`no`).
- **Numeric variables** are coerced from strings, so `"60"` and `60` both work.
- **An empty string is treated as unset.** If you provide `GOOGLE_DOMAIN=""`,
  validation fails the same way as omitting it.
