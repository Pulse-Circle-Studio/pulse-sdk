# Releasing (pulse-sdk)

Packages version independently. The release is driven entirely by a git tag;
CI does the verification and the publish.

## Steps

1. **Bump the version** in the target package's `package.json`
   (`packages/core`, `packages/web`, or `packages/react-native`). Keep
   `packages/core/src/version.ts` (`SDK_VERSION`) in sync — a unit test fails
   if it drifts from `@pulse/core`'s `package.json`.

2. **Land it on `main`** through a PR. CI must be green: lint, typecheck,
   conformance + unit tests, build, and the web size budget (≤ 10 KB gzip).

3. **Tag and push.** The tag prefix selects the package:

   | Package | Tag |
   |---|---|
   | `@pulse/core` | `core-v<version>` |
   | `@pulse/web` | `web-v<version>` |
   | `@pulse/react-native` | `react-native-v<version>` |

   ```bash
   git tag web-v0.1.0
   git push origin web-v0.1.0
   ```

4. The [publish workflow](./.github/workflows/publish.yml) verifies the tag
   matches `package.json`, re-runs tests + build + size gate, and runs
   `npm publish --provenance` for that workspace.

## Secrets

`NPM_TOKEN` (an npm automation token with publish rights to the `@pulse`
scope) must be set in the repository's GitHub Actions secrets. Provenance uses
the workflow's OIDC identity — no extra key needed.
