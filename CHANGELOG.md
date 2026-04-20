# Changelog

## [0.2.0](https://github.com/pelotech/jw-gws-sync/compare/v0.1.0...v0.2.0) (2026-04-20)


### Features

* add core sync logic — email resolution, diff engine, groups, and orchestrator (Phase 4) ([8b59e50](https://github.com/pelotech/jw-gws-sync/commit/8b59e50ebd197fe1a02d584edbc71e00518b28a7))
* add Dockerfile and Helm chart for deployment (Phase 6) ([16856f3](https://github.com/pelotech/jw-gws-sync/commit/16856f3f9de8459ce2112d657f121df3f40ffab2))
* add Justworks and Google Workspace API clients (Phase 3) ([7994861](https://github.com/pelotech/jw-gws-sync/commit/7994861fa85a0c89c6b3ac10cca97d6a78febbe6))
* add OAuth token management and admin page (Phase 2) ([53de0e0](https://github.com/pelotech/jw-gws-sync/commit/53de0e02950d7a37dbe774b4f88c6b503e9f842e))
* add Phase 1 foundation for Justworks-Google Workspace sync ([28904df](https://github.com/pelotech/jw-gws-sync/commit/28904dfea0ca9bea6a27bd874122f496fde918cd))
* add webhook handling, scheduling, and wire up main entrypoint (Phase 5) ([57a6edf](https://github.com/pelotech/jw-gws-sync/commit/57a6edf9eda306cd16e0cdd4b9a0b21abf4184e5))


### Bug Fixes

* add error handling to signal listeners and scheduler immediate sync ([125503b](https://github.com/pelotech/jw-gws-sync/commit/125503bf528f466bcab4f67a32c0a6b5c20c2a3f))
* add missing externalIds and relations to UpdateUserPayload ([31019fe](https://github.com/pelotech/jw-gws-sync/commit/31019fee13ffd6af68270b2f93fa4c1934d0d3c7))
* correct Google Directory API spec compliance in types ([9aee915](https://github.com/pelotech/jw-gws-sync/commit/9aee915b738f0a5f5cdef2adf76131c85ae10887))
* **docker:** pin base image to denoland/deno:2.1.4 ([5e5b8d0](https://github.com/pelotech/jw-gws-sync/commit/5e5b8d0fb9ebd7e0f554cc1ec9c008b58a4213c6))
* harden OAuth state management, disconnect endpoint, and token file permissions ([1965c36](https://github.com/pelotech/jw-gws-sync/commit/1965c36c60c4a89bc3ea8cd96e0d3e11fcc45b84))
* remove forced exit and add NaN validation for numeric config values ([3f2f2ba](https://github.com/pelotech/jw-gws-sync/commit/3f2f2ba0ababd78f9c188d65ed1c648a84e0cf85))
* **tests:** cast payload to BufferSource for TS 5.7+ compatibility ([57e4111](https://github.com/pelotech/jw-gws-sync/commit/57e4111b4d4fa69d7cc0432de63ad059ff4455b6))
* Use config-derived token URL and re-acquire token on retry ([2fa6b1d](https://github.com/pelotech/jw-gws-sync/commit/2fa6b1dbdd20c7b9e6723d786d99485742e08aed))
* **webhooks:** cast payload to BufferSource for TS 5.7+ compatibility ([dd51dbd](https://github.com/pelotech/jw-gws-sync/commit/dd51dbd4a7c0f06c6238c7e755c627ad58deb96e))


### Refactors

* replace manual env validation with Zod schema ([608fbb2](https://github.com/pelotech/jw-gws-sync/commit/608fbb27f91d640233828714e172536a45f46a7f))


### Chores

* add additional release please sections ([d39fe1c](https://github.com/pelotech/jw-gws-sync/commit/d39fe1c938e35efb7f3f2cbceec605cea677683b))
* add release-please and GHCR publish pipeline ([d76f031](https://github.com/pelotech/jw-gws-sync/commit/d76f031ab2adf0a81d4a2b07e637975a307badd3))
* apply deno fmt to existing source and test files ([96034f8](https://github.com/pelotech/jw-gws-sync/commit/96034f8e3b2d5eaabc8a7c909cd7ebf44a747fd4))
* **fmt:** exclude CHANGELOG.md from deno fmt ([35f5090](https://github.com/pelotech/jw-gws-sync/commit/35f50902baf180730068441f72095d04e2fd899f))
* rename project to jw-gws-sync ([4e26552](https://github.com/pelotech/jw-gws-sync/commit/4e265524778a756aed54c589e18d7f08bb727fb1))
* **webhooks:** apply deno fmt to verify.ts ([2a7b09f](https://github.com/pelotech/jw-gws-sync/commit/2a7b09f2a9f7694a7570e2f34eeca7e79efe140b))


### Docs

* add README and deployment/configuration/operations guides ([0e790ab](https://github.com/pelotech/jw-gws-sync/commit/0e790ab2c65d278f2145ef2ba9bb4b5d71257c05))
* add roadmap with multi-tenancy direction ([5555dcc](https://github.com/pelotech/jw-gws-sync/commit/5555dcc1f647fa0e48369217037f24093e9337df))
