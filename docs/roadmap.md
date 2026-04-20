# Roadmap

Forward-looking notes. Nothing here is committed work — it exists so that code
changes land in a direction that keeps the door open.

## Multi-tenancy (eventual)

The service is currently **single-tenant**: one Justworks org, one Google
Workspace, one set of credentials baked into a Kubernetes Secret.

The intended direction is a **self-service multi-tenant deployment** where:

- A new organization signs up (likely via a simple admin UI or a thin API).
- They complete the Justworks OAuth flow against _our_ single Justworks partner
  app.
- They upload _their own_ Google Workspace service-account JSON and specify
  their admin email, domain, and customer ID.
- The service begins syncing their roster automatically.

The goal is to get there **without introducing a database, a background job
system, or any other heavyweight state layer** — a service that currently boots
from a Kubernetes Secret should stay operable that way. The filesystem PVC the
service already uses for tokens is enough.

### Suggested architecture

Shape the refactor around these principles:

1. **The PVC is the state layer.** Replace the single `/data/jw-tokens.json`
   file with a per-tenant directory:
   ```
   /data/tenants/
     <tenant-id>/
       config.json   # google creds + admin email + domain + customer id + group prefix
       tokens.json   # justworks OAuth access + refresh tokens
       lastSync.json # small run log: timestamp, counts, circuit-breaker state
   ```
   A tenant record is a directory. Listing tenants is `readdirSync`. No
   database.

2. **Tenant ID derives from Justworks.** The Justworks org ID (returned during
   the partner OAuth handshake, and present on every webhook payload) is the
   tenant key. No separate identifier to issue or track.

3. **Partition the config model.**
   - Keep env vars for shared, operator-owned things: `JW_CLIENT_ID`,
     `JW_CLIENT_SECRET`, `WEBHOOK_SECRET`, `PORT`, `TOKEN_STORAGE_PATH`.
   - Move per-tenant fields (`GOOGLE_SERVICE_ACCOUNT_JSON`,
     `GOOGLE_ADMIN_EMAIL`, `GOOGLE_DOMAIN`, `GOOGLE_CUSTOMER_ID`,
     `EMAIL_DOMAIN`, `SYNC_DEPARTMENTS`, `PROTECTED_GROUP`, `GROUP_PREFIX`) into
     `TenantConfig` loaded from `config.json` above.
   - `loadConfig()` becomes `loadGlobalConfig()`; add `loadTenant(id)` and
     `listTenants()`.

4. **Clients take a `TenantConfig`, not `Config`.** `GoogleWorkspaceClient`,
   `EmailGenerator`, `GroupManager`, and `SyncOrchestrator` currently close over
   the global `Config`. Refactor them to accept a `TenantConfig` per call (or
   per-instance, constructed lazily). This is the largest code change and is
   best done early — while there is still only one tenant — so the shape of each
   class matches the eventual plural usage.

5. **Scheduler iterates tenants.** Replace the single `setInterval` loop with:
   ```
   for tenant in listTenants():
     if not syncInProgress[tenant.id]:
       runSync(tenant)  // existing SyncOrchestrator, parameterized
   ```
   Concurrency stays bounded (one sync per tenant at a time; simple in-memory
   lock keyed by tenant ID). No queueing system required until tenant counts
   reach the hundreds.

6. **Route webhooks by tenant.** Either
   - extract the tenant ID from the Justworks payload and dispatch, or
   - expose `POST /webhooks/justworks/<tenantId>` and configure each tenant's
     Justworks subscription to call their own URL.

   The latter is simpler and avoids trusting the payload before signature
   verification; the signing secret can be per-tenant (stored alongside
   `config.json`) or remain global.

7. **Onboarding UI is a small extension of `/oauth`.** Today `/oauth` is an
   admin page for a single connection. Turn it into:
   - `/admin/tenants` — list tenants (directory listing), each with "connected /
     not connected" status.
   - `/admin/tenants/new` — multi-step form: name → upload Google SA JSON →
     enter `admin email`, `domain`, `customer ID` → redirect into the Justworks
     OAuth flow → land back with the tenant fully provisioned.
   - `/admin/tenants/<id>` — show status, force-sync button, disconnect.

   Admin authentication becomes necessary at this point. The lightest option is
   Google OIDC against a fixed allowlist of operator emails — still no user
   database.

### What this deliberately does **not** introduce

- No Postgres/SQLite. The filesystem is already the durable store.
- No job queue (Redis/RabbitMQ/Celery). Sequential per-tenant sync in one
  process is fine for target scale.
- No multi-pod coordination. Keep it a single replica with a PVC; fail over by
  restart.
- No tenant-user accounts. Each tenant authenticates via their own Justworks +
  Google; operators authenticate via OIDC allowlist. End-users inside a tenant
  never talk to this service directly.

### Migration path from single-tenant

When the refactor lands, existing single-tenant deployments can migrate by:

1. Moving current Secret values into `/data/tenants/default/config.json` on the
   PVC.
2. Moving `/data/jw-tokens.json` → `/data/tenants/default/tokens.json`.
3. Restarting the pod. The service discovers one tenant (`default`) and syncs it
   exactly as before.

No data loss, no re-OAuth, no downtime beyond a pod restart.

---

_When a real multi-tenancy implementation begins, promote the relevant parts of
this document into the design spec under `docs/superpowers/specs/` and leave a
link here pointing forward._
