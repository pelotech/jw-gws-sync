# jw-gws-sync

A background service that keeps Google Workspace in sync with your Justworks
roster. Active employees get provisioned as Google users; terminations are
suspended; department-based Google Groups are created and reconciled.

## Status

- **Image:** `ghcr.io/pelotech/jw-gws-sync:<version>`
- **Helm chart:** `oci://ghcr.io/pelotech/charts/jw-gws-sync`
- **Current version:** `0.1.0`

Releases are cut automatically by
[release-please](https://github.com/googleapis/release-please) from conventional
commits on `main`.

## How it works

The sync runs on a timer (default every 60 minutes) and additionally reacts to
Justworks webhooks. On each sync:

1. **Fetch** active members from Justworks via the Partner API (paginated,
   OAuth).
2. **Filter** by `SYNC_DEPARTMENTS` (comma-separated allowlist, or `*` for all).
3. **Fetch** existing Google Workspace users via a service account JWT.
4. **Link** each Justworks member to a Google user by the Justworks ID stored as
   Google's `externalId` field. First-run bootstrap falls back to generating
   `firstname.lastname@<domain>`.
5. **Diff** — a pure, fully-tested function computes the set of creates,
   updates, and suspensions. Members in `PROTECTED_GROUP` are exempt from
   suspension.
6. **Execute** — mutations are applied sequentially with `RATE_LIMIT_DELAY_MS`
   spacing. If `DRY_RUN=true`, actions are logged only. If the suspension count
   exceeds `MAX_DELETES_PER_SYNC` (default 10), the sync aborts before any
   writes — a circuit breaker against mass deletes.

After the user sync, department-based Google Groups (named
`<GROUP_PREFIX>-<department>`) are created if missing and their membership is
reconciled.

## Quickstart

```sh
# 1. Create the secret (see docs/deployment.md for the full shape)
kubectl create secret generic jw-gws-sync-secrets \
  --from-literal=JW_CLIENT_ID=... \
  --from-literal=JW_CLIENT_SECRET=... \
  --from-file=GOOGLE_SERVICE_ACCOUNT_JSON=./sa-key.json \
  # ... etc

# 2. Install the chart
helm install jw-gws-sync oci://ghcr.io/pelotech/charts/jw-gws-sync \
  --version 0.1.0 \
  -f values.yaml

# 3. Complete the one-time OAuth bootstrap
open https://<your-ingress-host>/oauth
```

Full walkthrough: [`docs/deployment.md`](docs/deployment.md).

## Documentation

- [`docs/deployment.md`](docs/deployment.md) — prerequisites, secret shape, Helm
  install, ingress
- [`docs/configuration.md`](docs/configuration.md) — every environment variable
- [`docs/operations.md`](docs/operations.md) — OAuth bootstrap, dry-run, circuit
  breaker, webhooks, troubleshooting
- [`docs/roadmap.md`](docs/roadmap.md) — forward-looking direction, including
  planned multi-tenancy
- [`docs/superpowers/specs/2026-04-20-jw-gws-sync-design.md`](docs/superpowers/specs/2026-04-20-jw-gws-sync-design.md)
  — original design spec (architecture reference)

## Development

```sh
deno task dev    # run with --watch
deno task test   # 46 unit tests
deno task fmt    # format
deno task lint   # lint
deno task check  # type-check main.ts
```

Requires Deno 2.x. The Dockerfile builds from `denoland/deno:2.0`.

CI runs fmt, lint, type-check, and tests on every PR and on `main` (see
`.github/workflows/`).
