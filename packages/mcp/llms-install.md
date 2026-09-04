# Installing the Pulse MCP server (instructions for an AI agent)

You are installing Pulse for a developer who builds apps. This file tells you
which of the two Pulse servers to install, how, and how to know it worked.
Read all of section 1 before running anything.

## 1. Pick the right server

**There are two.** They share a name and a tool prefix but are not
interchangeable.

| | Offline (`@pulse-circle/mcp`) | Hosted (`https://mcp.pulse.pulsecircle.studio/mcp`) |
|---|---|---|
| Transport | stdio, over `npx` | streamable-http |
| Needs a Pulse account | **No** | Yes |
| Needs network at runtime | No — everything is baked into the package | Yes |
| Tools | 2: `pulse_setup_guide`, `pulse_connect` | 7: the same two plus `pulse_ask`, `pulse_verify`, `pulse_metrics_mrr`, `pulse_campaign_performance`, `pulse_funnel` |
| Answers questions about the user's own revenue | No | Yes |

Decision rule:

- The user wants to **add analytics to their app**, or asked how to connect
  RevenueCat / App Store / Google Play → **install the offline server**. It
  needs no account, no key and no network, so it cannot fail halfway and
  leave the user with a broken config.
- The user wants to **ask about their own revenue, MRR, ad spend, LTV or
  funnel** → they need the **hosted** server, which requires an account and a
  credential. Install it only if the user says they have a Pulse account, or
  is willing to create one at https://app.pulse.pulsecircle.studio. Do not
  invent or guess a key.
- Unsure? Install the offline one. It is additive: the hosted server can be
  added later under a different name.

Both are read-only with respect to the user's business data. No Pulse tool can
change a budget, a price or a campaign.

## 2. Install the offline server

Requirements: Node.js ≥ 18 and `npx` on PATH. Nothing to build, nothing to
clone, no environment variables.

**Cline** — add to `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "pulse": {
      "command": "npx",
      "args": ["-y", "@pulse-circle/mcp"]
    }
  }
}
```

If your client offers per-tool auto-approval, both tools qualify: they take a
single enum argument, touch no files, open no network connections and return
documentation text. (Field names for that vary by client version, so set it
through the client's own UI rather than by hand.)

**Claude Code** — one command:

```bash
claude mcp add pulse -- npx -y @pulse-circle/mcp
```

**Any other MCP client** — the same block; `mcpServers` with a `command` and
`args` is the standard stdio shape and needs no client-specific keys.

### Verify it

Call `pulse_setup_guide` with `{"platform": "react-native"}`. A working
install returns a step-by-step SDK guide that mentions `Pulse.init` and says
that revenue comes from connectors rather than from `track()`. If you get a
transport error instead, the client did not start the process — check that
`npx` resolves and that the client was restarted after the config edit.

## 3. Install the hosted server (only with the user's credential)

URL: `https://mcp.pulse.pulsecircle.studio/mcp` (streamable-http).

Two ways to authenticate. Prefer whichever the client supports natively:

1. **OAuth 2.1** with dynamic client registration — the server advertises
   RFC 9728 protected-resource metadata at
   `https://mcp.pulse.pulsecircle.studio/.well-known/oauth-protected-resource/mcp`
   and the authorization server is `https://app.pulse.pulsecircle.studio`.
   Clients that support remote MCP with OAuth need only the URL; the user
   approves access in a browser. Scope: `pulse.read`.
2. **API key** — `Authorization: Bearer <key>`, where the key comes from the
   user's Pulse Settings → API key (format `pk_…`). Ask the user to paste it;
   never read it from their files or guess it.

Claude Code, with a key the user supplied:

```bash
claude mcp add --transport http pulse-hosted https://mcp.pulse.pulsecircle.studio/mcp \
  --header "Authorization: Bearer <the user's pk_ key>"
```

Generic client config:

```json
{
  "mcpServers": {
    "pulse-hosted": {
      "type": "http",
      "url": "https://mcp.pulse.pulsecircle.studio/mcp",
      "headers": { "Authorization": "Bearer <the user's pk_ key>" }
    }
  }
}
```

### Verify it

Call `pulse_verify`. It reports which data sources are connected and whether
events have arrived recently — a real answer means auth worked. An
`Unauthorized` error with a `WWW-Authenticate` header means the credential is
missing or wrong, not that the server is down.

## 4. How to use the tools once installed

- **Never compute a metric yourself.** Do not add up revenue, average an MRR
  column or estimate LTV from what you can see. Ask `pulse_ask`, or call the
  metric tool, and quote what comes back. Pulse validates every number in its
  own answers against the underlying data; a number you derived has no such
  guarantee.
- **Pass the caveats through.** Answers can carry data-quality notes ("Google
  Play last synced 3 days ago"). Relay them to the user verbatim instead of
  dropping them — they are the difference between a number and a number the
  user can act on.
- **Setup order matters.** `pulse_setup_guide` installs the SDK for product
  events; revenue, MRR and LTV come from `pulse_connect` sources, not from
  `track()` calls. A user who only installs the SDK will not see revenue, and
  telling them otherwise wastes their afternoon.

## 5. If something goes wrong

| Symptom | Cause | What to do |
|---|---|---|
| `npx` fails to fetch the package | npm registry blocked | The offline server cannot be installed without npm access once. Nothing about Pulse is reachable in that sandbox either; say so plainly. |
| Tools appear but return nothing | Client did not restart | Restart the client after editing the config. |
| Hosted server returns `Unauthorized` | No or wrong credential | Ask for the `pk_` key, or use the OAuth flow. Do not retry with a guessed key. |
| Hosted server answers "no data yet" | Account has no connected sources | Use `pulse_connect` to guide the user through connecting RevenueCat, App Store or Google Play. |

Docs: https://pulse.pulsecircle.studio/docs/mcp/ · Issues:
https://github.com/Pulse-Circle-Studio/pulse-sdk/issues
