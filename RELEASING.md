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
first release of a brand-new package is the one exception. Use the manual
[first-release workflow](./.github/workflows/publish-first.yml):

1. Create a [granular access token](https://docs.npmjs.com/creating-and-viewing-access-tokens)
   on npmjs.com scoped to the new package only (Read and write, short expiry).
2. Add it as the `NPM_TOKEN` repository secret.
3. Actions → **Publish (first release, token)** → Run workflow → pick the
   workspace. It runs tests + build and publishes the version currently in
   that workspace's `package.json`.
4. Configure the trusted publisher (table above), then revoke the token on
   npmjs.com and delete the `NPM_TOKEN` secret.
5. Do **not** push a `<package>-v<first version>` tag afterwards — that
   version is already on npm and the tag-driven publish would fail. Tags take
   over from the next version.

Every release after that is tokenless.

Any stale `NPM_TOKEN` repository secret can be deleted once trusted publishing
is configured.
