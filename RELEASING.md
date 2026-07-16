# Releasing (pulse-sdk)

Packages version independently. The release is driven entirely by a git tag;
CI does the verification and the publish.

## Steps

1. **Bump the version** in the target package's `package.json`
   (`packages/core`, `packages/web`, `packages/react-native`, or
   `packages/mcp`). Keep `packages/core/src/version.ts` (`SDK_VERSION`) in
   sync — a unit test fails if it drifts from `@pulse-circle/core`'s
   `package.json`. Same for `packages/mcp`: the server version in
   `src/index.ts` must match its `package.json` (guarded by the smoke test).

2. **Land it on `main`** through a PR. CI must be green: lint, typecheck,
   conformance + unit tests, build, and the web size budget (≤ 10 KB gzip).

3. **Tag and push.** The tag prefix selects the package:

   | Package | Tag |
   |---|---|
   | `@pulse-circle/core` | `core-v<version>` |
   | `@pulse-circle/web` | `web-v<version>` |
   | `@pulse-circle/react-native` | `react-native-v<version>` |
   | `@pulse-circle/mcp` | `mcp-v<version>` |

   ```bash
   git tag web-v0.1.0
   git push origin web-v0.1.0
   ```

4. The [publish workflow](./.github/workflows/publish.yml) verifies the tag
   matches `package.json`, re-runs tests + build + size gate, and runs
   `npm publish --provenance` for that workspace.

## Authentication — Trusted Publishing (no token)

Publishing uses **npm Trusted Publishing over OIDC** — there is no `NPM_TOKEN`
secret to manage. The `publish.yml` job requests an `id-token` and npm
(≥ 11.5.1) exchanges it for a short-lived, scoped publish credential; provenance
is generated automatically.

One-time setup, per package, on npmjs.com → the package's **Settings → Trusted
Publisher**:

| Field | Value |
|---|---|
| Provider | GitHub Actions |
| Organization / repository | `Pulse-Circle-Studio/pulse-sdk` |
| Workflow filename | `publish.yml` |

The package must exist before you can attach a trusted publisher, so the very
first release of a brand-new package is the one exception: publish `0.1.0` once
with a temporary [granular access token](https://docs.npmjs.com/creating-and-viewing-access-tokens)
(or `npm publish` from a maintainer's machine), then configure the trusted
publisher and drop the token. Every release after that is tokenless.

Any stale `NPM_TOKEN` repository secret can be deleted once trusted publishing
is configured.
