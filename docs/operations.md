# Operations

Day-2 operation of `jw-gws-sync`: bootstrapping, safe rollouts, webhooks, and
troubleshooting.

## First-run OAuth bootstrap

The Justworks connection requires a one-time OAuth authorization by a
Justworks-admin user. Until it's done, `/readyz` returns `503` and no sync will
run.

1. Ensure ingress routes `https://<host>/oauth*` to the service.
2. Open `https://<host>/oauth` in a browser. You'll see a status page showing
   "Not connected".
3. Click **Connect to Justworks**. You are redirected to Justworks, sign in with
   an admin account, and approve.
4. Justworks redirects back to `/oauth/callback`; the service exchanges the code
   and persists tokens to `TOKEN_STORAGE_PATH` (default `/data/jw-tokens.json`).
5. Verify: `curl https://<host>/oauth/status` →
   `{"connected": true, "expiresAt": "...", "expiresIn": ...}`.
6. Readiness now flips to 200, and the scheduler runs its first sync
   immediately.

To revoke and re-bootstrap, `POST /oauth/disconnect` (from the admin UI) or
delete `TOKEN_STORAGE_PATH` and restart the pod.

## Dry-run workflow

Run the first real sync against your cluster with `DRY_RUN=true`. In dry-run
mode the service:

- **Does** fetch Justworks members, fetch Google users, compute the full diff,
  run the circuit-breaker check, and log every planned action.
- **Does not** call any Google Workspace mutation endpoint (no user created,
  updated, or suspended; no group touched).

Log lines tagged with the planned operation let you review exactly what would
change. When satisfied, set `DRY_RUN=false` and redeploy.

## Circuit breaker

`MAX_DELETES_PER_SYNC` (default `10`) protects against accidental mass
terminations — e.g. a Justworks API outage that returns an empty roster.

When the diff would suspend more users than the limit, the sync aborts **before
any writes** and logs the attempted count. Nothing is executed. Investigate the
cause (often a Justworks paging/API issue) and either fix the source data or
raise the limit in `values.yaml`.

## Protected group

Members of the group identified by `PROTECTED_GROUP` (a Google Group email) are
never suspended, even if they no longer appear as active in Justworks. Use this
for contractors, service accounts, or any workspace identity that shouldn't
follow the Justworks roster.

## Webhooks

Justworks events are delivered to `POST https://<host>/webhooks/justworks`.

- **Signature verification**: the `x-justworks-signature` header must be
  `WEBHOOK_SECRET`-HMAC-SHA256 of the raw body. Mismatches → `401`.
- **Deduplication**: the handler keeps a 1-hour in-memory dedup cache keyed on
  event ID, so a Justworks retry won't cause duplicate processing within that
  window.
- **Response**: the service responds `200` immediately after verification and
  processes the event asynchronously.

A webhook that mutates Justworks state triggers the same sync path as the
scheduler — just scoped to the affected member.

## Health checks

| Endpoint       | Behavior                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz` | Always `200 {"status":"ok"}` — liveness only. If this stops responding, the pod is hung and should be restarted.    |
| `GET /readyz`  | `200 {"status":"ready"}` once Justworks OAuth tokens are present and valid; otherwise `503 {"status":"not ready"}`. |

Kubernetes probe tunings are in `values.yaml`:

- Liveness: initial delay 10 s, period 30 s.
- Readiness: initial delay 5 s, period 10 s.

## Observability

Logs are structured JSON on stdout. Useful searches:

- `"Starting jw-gws-sync"` — pod startup, includes `buildVersion`.
- `"Configuration loaded"` — dumps non-secret config at INFO.
- `"Starting sync"` / `"Sync complete"` — per-run boundaries.
- `"Dry run"` — present when `DRY_RUN=true` blocks a mutation.
- `"Circuit breaker"` / `"Aborting sync"` — MAX_DELETES_PER_SYNC tripped.
- `"Shutdown error"` — surfaced errors from the graceful-shutdown path.

Because all API mutations are sequential and log-wrapped, a failed sync leaves
breadcrumbs indicating exactly how far it got.

## Upgrading

Releases follow conventional commits on `main`. A release PR opened by
release-please bumps `Chart.yaml` (`version` + `appVersion`) and
`charts/jw-gws-sync/README.md` together. Merging it creates a git tag, an OCI
image at `ghcr.io/pelotech/jw-gws-sync:<version>`, and a chart at
`ghcr.io/pelotech/charts/jw-gws-sync:<version>`.

Upgrade in-cluster:

```sh
helm upgrade jw-gws-sync oci://ghcr.io/pelotech/charts/jw-gws-sync \
  --version <new-version> \
  -n jw-gws-sync -f values.yaml
```

The Deployment will roll with zero downtime (single replica — there is a brief
pause during rollout because the PVC is RWO and cannot be mounted by both old
and new pods; use `strategy.type: Recreate` if your storage class requires it).

## Common issues

| Symptom                                                     | Likely cause                                                                         | Fix                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `/readyz` returns 503 forever after deploy                  | OAuth never bootstrapped                                                             | Visit `/oauth` and complete the flow                          |
| OAuth redirect loops or fails                               | `JW_REDIRECT_URI` does not exactly match the Justworks app config or the ingress URL | Align all three                                               |
| Sync skips expected members                                 | `SYNC_DEPARTMENTS` excludes them, or `SYNC_INCLUDE_NO_DEPARTMENT=false`              | Check both; logs print the filter on each run                 |
| Webhooks return 401                                         | `WEBHOOK_SECRET` mismatch with Justworks config                                      | Rotate and re-save in both places                             |
| Tokens disappear after pod restart                          | PVC not mounted at `/data`, or `persistence.enabled=false`                           | Enable persistence and redeploy; then re-bootstrap OAuth once |
| Google API 403 `Not Authorized to access this resource/api` | Domain-wide delegation scopes not added, or wrong `GOOGLE_ADMIN_EMAIL`               | Re-check delegation setup in Admin console                    |
| Sync aborts with "Circuit breaker"                          | Planned suspensions > `MAX_DELETES_PER_SYNC`                                         | Investigate roster; do not blindly raise the limit            |
