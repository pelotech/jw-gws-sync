# Justworks → Google Workspace Sync Service

## Context

Pelotech needs to automatically provision and manage Google Workspace user
accounts based on employee/contractor data from Justworks (HR platform).
Currently there is no automated integration — user provisioning is manual,
leading to delays for new hires and stale accounts for terminated employees.

This service bridges that gap: it reads employee data from the Justworks Partner
API and provisions/updates/suspends Google Workspace accounts accordingly.

## Requirements

1. **Pull employee & contractor data** from Justworks: name, email, department,
   phone, title, employment status
2. **Full provisioning** in Google Workspace: create accounts for new employees,
   update directory fields, suspend terminated employees
3. **Two sync modes**: scheduled full sync (poll-based) + webhook listener (near
   real-time)
4. **Email resolution**: use Justworks work email if present, otherwise generate
   `firstname.lastname@domain`
5. **Dry-run mode** for safe rollout
6. **Circuit breaker** to prevent mass-suspension from API outages
7. **OAuth admin page**: simple web UI for managing the Justworks OAuth token
   exchange (initial setup + status)
8. **Department-based Google Groups**: create and manage Google Groups per
   department with a configurable prefix (e.g., `justworks-Engineering`)
9. **Department filtering**: configurable to sync all departments or only a
   specific list
10. **Protected group**: a configurable Google Workspace group whose members are
    exempt from suspension (allows manually provisioned users)

## Tech Stack

- **Runtime**: Deno (TypeScript)
- **APIs**: Justworks Partner API (OAuth 2.0), Google Workspace Admin SDK
  (service account + domain-wide delegation)
- **Deployment**: Docker container on EKS, Helm chart

## Architecture

Single Deno service (monolith) running two concurrent loops:

```
┌─────────────────────────────────────────────────┐
│                  main.ts                         │
│                                                  │
│  ┌─────────────┐       ┌──────────────────────┐ │
│  │  Scheduler   │       │  HTTP Server         │ │
│  │  (interval)  │       │  /healthz            │ │
│  │              │       │  /readyz             │ │
│  │  fullSync()  │       │  /webhooks/justworks │ │
│  │              │       │  /oauth/*            │ │
│  └──────┬───────┘       └──────────┬───────────┘ │
│         │                          │              │
│         └──────────┬───────────────┘              │
│                    ▼                              │
│           ┌─────────────┐                        │
│           │ SyncOrchestrator                     │
│           │  - fetch JW members                  │
│           │  - fetch GWS users                   │
│           │  - compute diff                      │
│           │  - execute actions                   │
│           └──────┬──────┘                        │
│         ┌────────┼─────────┐                     │
│         ▼        ▼         ▼                     │
│   ┌──────────┐ ┌─────┐ ┌───────┐               │
│   │JW Client │ │Diff │ │GWS    │               │
│   │(OAuth)   │ │Engine│ │Client │               │
│   └──────────┘ └─────┘ └───────┘               │
└─────────────────────────────────────────────────┘
```

## Project Structure

```
jw-gws-sync/
├── deno.json
├── main.ts                      # Entrypoint: HTTP server + scheduler
├── src/
│   ├── config.ts                # Env var loading + validation
│   ├── server.ts                # HTTP routes (health + webhooks + oauth)
│   ├── scheduler.ts             # Interval-based full sync trigger
│   ├── sync.ts                  # Orchestrator: fetch → diff → execute
│   ├── diff.ts                  # Pure reconciliation engine
│   ├── email.ts                 # Email resolution + conflict handling
│   ├── groups.ts                # Google Groups management (department-based)
│   ├── logger.ts                # Structured JSON logger
│   ├── clients/
│   │   ├── justworks.ts         # Justworks OAuth + member endpoints
│   │   └── google.ts            # Google Admin SDK (JWT auth + user/group CRUD)
│   ├── types/
│   │   ├── justworks.ts         # Justworks API response types
│   │   ├── google.ts            # Google Directory API types
│   │   └── internal.ts          # CanonicalMember, SyncAction, SyncResult
│   ├── oauth/
│   │   ├── routes.ts            # OAuth admin page routes
│   │   ├── store.ts             # Token persistence (file-based)
│   │   └── page.html            # Simple admin UI (inline HTML)
│   └── webhooks/
│       ├── handler.ts           # Webhook route handler
│       └── verify.ts            # HMAC signature verification
├── tests/
│   ├── diff_test.ts
│   ├── email_test.ts
│   ├── sync_test.ts
│   └── webhook_test.ts
├── Dockerfile
└── charts/
    └── jw-gws-sync/
        ├── Chart.yaml
        ├── values.yaml
        └── templates/
```

## Core Design

### Linkage Model

The Justworks member ID is stored as a Google Workspace `externalId`
(`customType: "justworks_id"`). This is the **authoritative link** between the
two systems. It survives name changes, email changes, and department changes.

For bootstrapping (first sync with existing Google users), email matching is
used as a fallback. Once matched, the externalId is stamped for future syncs.

### Diff Engine (`diff.ts`)

Pure function, no side effects, fully unit-testable.

```
computeSyncActions(jwMembers, googleUsers) → SyncAction[]
```

**Algorithm:**

1. Build lookup maps: Google users indexed by Justworks externalId and by email
2. For each active JW member:
   - Find matching Google user (by externalId, fallback to email)
   - No match → `CREATE`
   - Match found → compare fields → `UPDATE` if different, `NO_CHANGE` if same
   - Match is suspended but JW member is active → `UPDATE` (unsuspend)
3. For each Google user with a Justworks externalId not in active JW members →
   `SUSPEND`
4. Never touch Google users without a Justworks externalId (manually managed)

**Actions**: `CREATE`, `UPDATE`, `SUSPEND`, `SKIP_PROTECTED`, `NO_CHANGE`

### Sync Orchestrator (`sync.ts`)

**Full sync flow:**

1. Fetch all active members from Justworks (paginated)
2. Filter by configured departments (if `SYNC_DEPARTMENTS` is not `*`)
3. Fetch all users from Google Workspace
4. Fetch protected group membership (if `PROTECTED_GROUP` is set)
5. Resolve emails for each JW member
6. Compute diff (pure function call, respecting protected group)
7. Circuit breaker: abort if suspensions > `MAX_DELETES_PER_SYNC`
8. If `DRY_RUN=true`, log actions and return
9. Execute user actions sequentially with rate limiting
10. Sync department-based Google Groups (create groups, reconcile membership)
11. Collect errors (partial failure tolerance — one bad record doesn't block
    others)
12. Return `SyncResult` with summary

**Single member sync flow (webhook-triggered):**

1. Fetch specific member from Justworks
2. Check department filter (skip if not in synced departments)
3. Find corresponding Google user
4. Check protected group membership
5. Compute single diff
6. Execute action + update group membership for member's department

### Email Resolution (`email.ts`)

1. Check JW member's `emails` array for a `WORK` email matching `*@{domain}` →
   use it
2. Otherwise generate: `normalize(givenName).normalize(familyName)@domain`
   - Normalize: lowercase, strip diacritics, replace spaces/hyphens with dots,
     remove special chars
3. Check Google Workspace for conflicts
4. If conflict: try `firstname.m.lastname@domain`, then
   `firstname.lastname2@domain`, etc.
5. Cache resolved emails within a sync batch to handle same-run conflicts

### Webhook Handler

- Verify HMAC-SHA256 signature (constant-time comparison)
- Check idempotency (in-memory set of `{memberId}:{timestamp}`, 1hr TTL)
- Respond 200 immediately (within Justworks 5-second timeout)
- Process sync asynchronously

### OAuth Admin Page (`oauth/`)

The Justworks Partner API uses OAuth 2.0 Authorization Code flow, which requires
a browser-based initial token exchange. The service serves a simple admin page
for this:

**Routes:**

- `GET /oauth` — admin page showing current token status (valid/expired/missing)
  and a "Connect to Justworks" button
- `GET /oauth/authorize` — redirects to Justworks authorization URL
- `GET /oauth/callback` — handles the OAuth callback, exchanges code for tokens,
  stores them
- `GET /oauth/status` — JSON endpoint returning token health (for monitoring)

**Token storage** (`oauth/store.ts`):

- Tokens (access + refresh) persisted to a file (`/data/jw-tokens.json`) mounted
  via a PersistentVolume in K8s
- On startup, load existing tokens; if expired, use refresh token to get new
  ones
- If no tokens exist, the service starts but sync is disabled — the admin page
  shows "Not connected"
- The `/readyz` endpoint returns unhealthy when no valid tokens are available

**Admin page** (`oauth/page.html`):

- Minimal HTML page (no framework, inline CSS)
- Shows: connection status, token expiry, last sync time
- "Connect to Justworks" button to initiate OAuth flow
- "Disconnect" button to clear stored tokens

### Department-Based Google Groups (`groups.ts`)

Creates and manages Google Groups based on Justworks departments, with a
configurable prefix.

**Configuration:**

- `GROUP_PREFIX` — prefix for group names/emails (e.g., `justworks` → group
  email `justworks-engineering@domain`)
- Group email format: `{prefix}-{normalized_department}@{domain}`
  - Normalize: lowercase, replace spaces with hyphens, remove special chars
  - Example: department "Product Engineering" →
    `justworks-product-engineering@pelotech.com`

**Sync behavior:**

1. Collect all unique departments from synced Justworks members
2. For each department, ensure a Google Group exists with the prefixed name
   - Create if missing
   - Group display name: `{Prefix} {Department}` (e.g., "Justworks Engineering")
3. For each group, reconcile membership:
   - Add members who are in the JW department but not in the Google Group
   - Remove members who are in the Google Group but no longer in the JW
     department
4. Delete (or leave orphaned — configurable) groups for departments that no
   longer exist in Justworks
5. Groups are tagged with a description marker (e.g., "Managed by jw-gws-sync")
   so manually created groups are never touched

**Google API scopes needed:** `admin.directory.group`,
`admin.directory.group.member`

### Department Filtering

Configurable to sync all departments or only specific ones.

**Configuration:**

- `SYNC_DEPARTMENTS` — comma-separated list of department names to sync, or `*`
  for all (default: `*`)
- Example: `SYNC_DEPARTMENTS=Engineering,Product,Design` — only syncs members in
  those three departments
- Members in non-synced departments are ignored entirely (not created, not
  suspended)

**Behavior:**

- Filtering happens early in the sync pipeline, right after fetching JW members
- If a member has no department set in Justworks, they are included when
  `SYNC_DEPARTMENTS=*` and excluded otherwise (configurable via
  `SYNC_INCLUDE_NO_DEPARTMENT`, default `true`)
- Department matching is case-insensitive

### Protected Group (Suspension Exemption)

A configurable Google Workspace group whose members are exempt from suspension.
This allows users provisioned outside of Justworks to coexist safely.

**Configuration:**

- `PROTECTED_GROUP` — email of a Google Group (e.g.,
  `gws-protected@pelotech.com`)
- Members of this group are never suspended by the sync service, even if they
  have a Justworks externalId that is no longer active

**Behavior:**

1. During diff computation, before emitting a `SUSPEND` action, check if the
   user is a member of the protected group
2. If they are, emit `SKIP_PROTECTED` instead (logged but no action taken)
3. The protected group is managed manually by admins — the sync service only
   reads its membership, never writes to it
4. If `PROTECTED_GROUP` is not set, this feature is disabled (all standard
   suspension rules apply)

### API Clients

**Justworks** (`clients/justworks.ts`):

- OAuth 2.0 Authorization Code flow
- Token caching with expiry-aware refresh
- `listActiveMembers()`: paginated, filtered by `employment_status=ACTIVE`
- `getMember(id)`: single member fetch
- Retry with exponential backoff on 429/5xx

**Google Workspace** (`clients/google.ts`):

- Service account JWT with domain-wide delegation
- Scopes: `admin.directory.user`, `admin.directory.group`,
  `admin.directory.group.member`
- User methods: `listUsers()`, `createUser()`, `updateUser()`, `suspendUser()`
- Group methods: `listGroups()`, `createGroup()`, `deleteGroup()`,
  `listGroupMembers()`, `addGroupMember()`, `removeGroupMember()`
- Configurable rate limiting between calls (default 100ms)

## Configuration

All via environment variables:

| Variable                      | Required | Default                               | Description                                                              |
| ----------------------------- | -------- | ------------------------------------- | ------------------------------------------------------------------------ |
| `JW_CLIENT_ID`                | yes      | —                                     | Justworks OAuth client ID                                                |
| `JW_CLIENT_SECRET`            | yes      | —                                     | Justworks OAuth client secret                                            |
| `JW_BASE_URL`                 | no       | `https://public-api.justworks.com/v1` | API base URL                                                             |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | yes      | —                                     | Service account key (JSON)                                               |
| `GOOGLE_ADMIN_EMAIL`          | yes      | —                                     | Admin to impersonate                                                     |
| `GOOGLE_DOMAIN`               | yes      | —                                     | e.g. pelotech.com                                                        |
| `GOOGLE_CUSTOMER_ID`          | yes      | —                                     | Directory API scoping                                                    |
| `EMAIL_DOMAIN`                | yes      | —                                     | Domain for generated emails                                              |
| `WEBHOOK_SECRET`              | yes      | —                                     | HMAC signing secret                                                      |
| `SYNC_INTERVAL_MINUTES`       | no       | `60`                                  | Full sync interval                                                       |
| `DRY_RUN`                     | no       | `false`                               | Log actions without executing                                            |
| `MAX_DELETES_PER_SYNC`        | no       | `10`                                  | Circuit breaker threshold                                                |
| `RATE_LIMIT_DELAY_MS`         | no       | `100`                                 | Delay between Google API calls                                           |
| `PORT`                        | no       | `8080`                                | HTTP server port                                                         |
| `DEFAULT_ORG_UNIT_PATH`       | no       | `/`                                   | Default Google Workspace OU                                              |
| `GROUP_PREFIX`                | no       | `justworks`                           | Prefix for department Google Groups                                      |
| `SYNC_DEPARTMENTS`            | no       | `*`                                   | Comma-separated departments to sync, or `*` for all                      |
| `SYNC_INCLUDE_NO_DEPARTMENT`  | no       | `true`                                | Include members with no department when filtering                        |
| `PROTECTED_GROUP`             | no       | —                                     | Google Group email whose members are exempt from suspension              |
| `TOKEN_STORAGE_PATH`          | no       | `/data/jw-tokens.json`                | Path for persisted OAuth tokens                                          |
| `JW_REDIRECT_URI`             | yes      | —                                     | OAuth callback URL (e.g., `https://jw-sync.pelotech.com/oauth/callback`) |

## Error Handling

1. **Client level**: Retry with exponential backoff (1s, 2s, 4s, max 3 retries)
   on transient errors
2. **Sync level**: Individual action failures collected, don't abort the batch
3. **Circuit breaker**: Abort if too many suspensions detected
4. **Webhook level**: Respond 200 before processing; failures caught by next
   full sync
5. **Process level**: Uncaught exceptions logged, process exits (K8s restarts)

## Edge Cases

- **Name conflicts**: Email generator checks for existing users, appends numbers
- **Bootstrapping**: First run with `DRY_RUN=true` to review; email fallback for
  initial linkage
- **Justworks outage**: Circuit breaker prevents mass suspension from empty API
  response
- **Duplicate webhooks**: In-memory idempotency set, plus full sync is
  self-healing
- **Name changes**: Handled naturally — linkage is via Justworks ID, not
  name/email
- **Preferred names**: `preferred_name` used as `givenName` in Google when
  present
- **Protected users**: Members of the protected group are never suspended, even
  if terminated in Justworks
- **Department changes**: When a member moves departments, they are removed from
  the old department group and added to the new one during the next sync
- **No OAuth tokens on startup**: Service starts but sync is disabled; `/readyz`
  returns unhealthy; admin page prompts to connect
- **Token refresh failure**: Log error, mark service as not ready, admin page
  shows "Reconnect" button

## Deployment

- **Dockerfile**: Multi-stage Deno build, runs as non-root `deno` user
- **Helm chart**: Standard org template, single replica, secrets from
  ExternalSecrets
- **Health probes**: `GET /healthz` (liveness), `GET /readyz` (readiness —
  unhealthy when no valid JW tokens)
- **Endpoints**: `POST /webhooks/justworks`, `POST /sync` (manual trigger),
  `GET /oauth` (admin page), `GET /oauth/status` (token health JSON)

## Verification Plan

1. **Unit tests**: `diff_test.ts` (reconciliation logic including protected
   group), `email_test.ts` (generation + conflicts), `groups_test.ts` (group
   name generation + membership diff)
2. **Integration tests**: Mock API clients, test `sync.ts` orchestration with
   department filtering and group sync
3. **Webhook tests**: Signature verification, idempotency dedup
4. **OAuth tests**: Token store persistence, refresh flow, callback handler
5. **Manual E2E**: Run with `DRY_RUN=true` against real APIs, review logged
   actions including group operations
6. **Staged rollout**: Enable writes for a small subset first (use
   `SYNC_DEPARTMENTS` to limit scope), then full org

## Implementation Phases

1. **Foundation**: `deno.json`, config (including new env vars), logger, types,
   health endpoints
2. **OAuth Admin Page**: token store, OAuth routes, admin HTML page, wire into
   server
3. **API Clients**: Justworks OAuth (using token store) + member listing, Google
   JWT + user/group CRUD
4. **Core Logic**: Email resolver, diff engine (with protected group +
   department filtering), group manager, sync orchestrator + tests
5. **Webhooks + Scheduling**: Signature verify, handler, scheduler, wire up
   `main.ts`
6. **Deployment**: Dockerfile, Helm chart (with PersistentVolume for token
   storage), org config files, E2E testing
