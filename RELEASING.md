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
   on npmjs.com with Read/Write on the `@pulse-circle` scope — a package that
   doesn't exist yet can't be selected individually. Short expiry (7 days).
2. Add it as the `NPM_TOKEN` repository secret.
3. Actions → **Publish (first release, token)** → Run workflow → pick the
   workspace. It runs tests + build and publishes the version currently in
   that workspace's `package.json`.
4. Configure the trusted publisher (table above), then revoke the token on
   npmjs.com and delete the `NPM_TOKEN` secret.
5. Do **not** push a `<package>-v<first version>` tag afterwards — that
   version is already on npm and the tag-driven publish would fail. Tags take
   over from the next version.

**Order matters for `react-native`.** `@pulse-circle/react-native` declares a
runtime dependency on `@pulse-circle/core`, so `core` must already be on the
registry or the RN package installs broken. Bootstrap `@pulse-circle/core`
first, confirm `npm view @pulse-circle/core version`, then bootstrap
`@pulse-circle/react-native`. (`@pulse-circle/web` bundles core at build time
and has zero runtime dependencies, so it is unaffected.)

Every release after that is tokenless.

Any stale `NPM_TOKEN` repository secret can be deleted once trusted publishing
is configured.

## Listing the MCP server in the official MCP Registry

The registry stores **metadata only** — the package still comes from npm. It
also verifies ownership two ways, so both have to line up:

1. `packages/mcp/package.json` carries `"mcpName": "studio.pulsecircle/pulse"`,
   which the registry reads from the **published** tarball. Publish the npm
   package first (tag `mcp-v0.1.1`); a server.json claiming a name the
   published package does not declare is rejected.
2. The name's namespace must be one you can prove. `studio.pulsecircle` is the
   reverse-DNS form of `pulsecircle.studio` — the same convention as the Maven
   namespace — and is proved by a DNS TXT record.

```bash
brew install mcp-publisher   # or the release binary, see the registry docs

# One-time: generate a key pair and publish its public half at the APEX.
# Apex, not a selector: MCP DNS auth is SPF-style. A record under
# _mcp-auth.pulsecircle.studio is invisible to the registry and fails with a
# generic signature error.
openssl genpkey -algorithm Ed25519 -out mcp-registry-key.pem
PUB="$(openssl pkey -in mcp-registry-key.pem -pubout -outform DER | tail -c 32 | base64)"
echo "pulsecircle.studio. IN TXT \"v=MCPv1; k=ed25519; p=${PUB}\""
# ^ add that TXT record, alongside the existing Sonatype one, then:

cd packages/mcp
# --private-key takes the 32-byte seed as 64 HEX CHARACTERS, not a path to the
# PEM. Passing the filename gets you "failed to decode private key", which
# reads like a bad key rather than a wrong argument type.
PRIVATE_KEY=$(openssl pkey -in mcp-registry-key.pem -noout -text \
  | grep -A3 'priv:' | tail -n +2 | tr -d ' :\n')
[ ${#PRIVATE_KEY} -eq 64 ] || { echo "expected 64 hex chars, got ${#PRIVATE_KEY}"; }
mcp-publisher login dns --domain pulsecircle.studio --private-key "$PRIVATE_KEY"
mcp-publisher validate
mcp-publisher publish
```

On macOS use the Homebrew openssl for that extraction too
(`/opt/homebrew/opt/openssl@3/bin/openssl`) — see the LibreSSL note below.

Keep `mcp-registry-key.pem` out of the repo — it is the credential for the
whole namespace. If you rotate it, delete the old TXT record: a stale one is
tried first and fails verification.

On macOS the system `openssl` is LibreSSL and has no Ed25519 in `genpkey`; use
`brew install openssl@3` and call it by full path, or switch to the ECDSA P-384
variant from the registry docs.

Simpler alternative: `mcp-publisher login github` (device flow). It works with
no DNS at all, but the name then has to be `io.github.pulse-circle-studio/pulse`
and you must be an **Owner** of the GitHub org, not just a member.

Bump `version` in **both** `package.json` and `server.json` on every release —
`server.json` has two of them, the top-level server version and
`packages[0].version`.

**Order matters, and it is the reverse of what feels natural.** npm first, the
registry second:

1. Push the tag `mcp-v<version>` — `publish.yml` publishes to npm over OIDC.
   Wait for it to go green.
2. Then run `mcp-publisher publish` locally.

The registry resolves `packages[0].version` against npm to confirm the package
declares the matching `mcpName`. Publish the registry entry first and it points
at a version that does not exist yet.
