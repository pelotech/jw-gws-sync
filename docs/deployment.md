# Deployment

This guide walks an operator from zero to a running `jw-gws-sync` in a
Kubernetes cluster.

## Prerequisites

### 1. Justworks OAuth application

The service acts on behalf of a Justworks Partner app. You need:

- **Client ID** → `JW_CLIENT_ID`
- **Client Secret** → `JW_CLIENT_SECRET`
- **Redirect URI** → `JW_REDIRECT_URI` — must match the URL you'll expose via
  ingress. Pattern: `https://<host>/oauth/callback`.

Create the app in the Justworks Partner Portal. Refer to Justworks' own partner
API docs for the current UI and required scopes — the service uses the members
API and webhook subscriptions.

### 2. Google Workspace service account with domain-wide delegation

The service authenticates to Google as a service account that impersonates a
workspace admin.

1. In Google Cloud Console, create a service account in a project that has the
   **Admin SDK API** enabled.
2. Download its key as JSON → this entire file is the value of
   `GOOGLE_SERVICE_ACCOUNT_JSON`.
3. In the service account details, enable **domain-wide delegation** and copy
   the **client ID**.
4. In the Google Workspace Admin console → **Security → API controls →
   Domain-wide delegation**, add the client ID with these three scopes:

   ```
   https://www.googleapis.com/auth/admin.directory.user
   https://www.googleapis.com/auth/admin.directory.group
   https://www.googleapis.com/auth/admin.directory.group.member
   ```

5. Choose a super-admin user for the service to impersonate →
   `GOOGLE_ADMIN_EMAIL`.
6. Note the workspace domain (e.g. `example.com`) → `GOOGLE_DOMAIN` and
   `EMAIL_DOMAIN`.
7. Note the customer ID (Admin console → Account → Account settings) →
   `GOOGLE_CUSTOMER_ID`.

### 3. Webhook HMAC secret

Generate a strong random secret (e.g. `openssl rand -hex 32`) and:

- Set it as `WEBHOOK_SECRET` in the service.
- Configure the same value in the Justworks webhook subscription settings.

The service verifies the `x-justworks-signature` header on every incoming
webhook using HMAC-SHA256. Mismatches return `401`.

### 4. Persistent storage

The service persists the Justworks OAuth refresh token at `/data/jw-tokens.json`
so the connection survives pod restarts. The Helm chart provisions a `1Gi`
`ReadWriteOnce` PVC by default (`persistence.enabled: true` in `values.yaml`).

If you disable persistence, you will have to redo the OAuth bootstrap every time
the pod restarts.

## Kubernetes Secret

Create a secret named `jw-gws-sync-secrets` (overridable via `values.yaml` →
`secretName`) with the following keys. Every key is injected as an env var of
the same name.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: jw-gws-sync-secrets
type: Opaque
stringData:
  # Justworks
  JW_CLIENT_ID: "..."
  JW_CLIENT_SECRET: "..."
  JW_REDIRECT_URI: "https://jw-sync.example.com/oauth/callback"

  # Google
  GOOGLE_SERVICE_ACCOUNT_JSON: |
    { ... full service-account JSON ... }
  GOOGLE_ADMIN_EMAIL: "admin@example.com"
  GOOGLE_DOMAIN: "example.com"
  GOOGLE_CUSTOMER_ID: "C0123abc4"

  # Sync target
  EMAIL_DOMAIN: "example.com"

  # Webhook signing
  WEBHOOK_SECRET: "<32-byte hex>"
```

Non-secret tuning values (e.g. `SYNC_INTERVAL_MINUTES`, `DRY_RUN`) can go in the
same secret or be set via `values.yaml` → `env:`. See
[`configuration.md`](configuration.md) for the full list.

## Install the chart

```sh
helm install jw-gws-sync \
  oci://ghcr.io/pelotech/charts/jw-gws-sync \
  --version 0.1.0 \
  --namespace jw-gws-sync --create-namespace \
  -f values.yaml
```

Minimal `values.yaml`:

```yaml
env:
  DRY_RUN: "true" # recommended for first deploy
  SYNC_INTERVAL_MINUTES: "60"

persistence:
  enabled: true
  size: 1Gi
  storageClass: "" # cluster default

resources:
  requests: { cpu: 100m, memory: 128Mi }
  limits: { cpu: 500m, memory: 256Mi }
```

What the chart installs:

- **Deployment** (1 replica) running the Deno service on port 8080 as user
  `deno`.
- **Service** (ClusterIP) on port 8080.
- **PersistentVolumeClaim** (1Gi, RWO) mounted at `/data`.
- Liveness (`GET /healthz`, 30 s) and readiness (`GET /readyz`, 10 s) probes.

## Ingress / external URL

**The chart does not ship an Ingress resource.** You must create your own (or
equivalent — `Gateway`, `HTTPRoute`, external LB) so that:

- Justworks can POST to `https://<host>/webhooks/justworks`.
- The OAuth callback `https://<host>/oauth/callback` matches `JW_REDIRECT_URI`.
- An admin can reach `https://<host>/oauth` to bootstrap the connection.

Restrict public exposure to the minimum needed — the webhook endpoint and the
OAuth pages must be reachable from the internet; nothing else must be.

## Post-deploy

The pod will come up but readiness will return `503` until the OAuth bootstrap
is complete. Follow
[`operations.md → First-run OAuth bootstrap`](operations.md#first-run-oauth-bootstrap).

It is strongly recommended to run the first sync cycle with `DRY_RUN=true` and
review logs before switching to write mode.
