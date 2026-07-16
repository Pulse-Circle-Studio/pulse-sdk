# @pulse-circle/mcp

Local (stdio) MCP server for [Pulse](https://app.pulse.pulsecircle.studio):
gives AI coding agents the Pulse SDK setup and store-connection guides —
**fully offline**. Everything it serves is baked in at build time, so it works
in hardened sandboxes where Pulse domains are blocked but npm is allowed.

## Add to Claude Code

```bash
claude mcp add pulse -- npx -y @pulse-circle/mcp
```

Or in any MCP client config:

```json
{
  "mcpServers": {
    "pulse": { "command": "npx", "args": ["-y", "@pulse-circle/mcp"] }
  }
}
```

## Tools

| Tool | Input | Returns |
|---|---|---|
| `pulse_setup_guide` | `platform`: `web` \| `react-native` \| `swift` \| `kotlin` | Step-by-step SDK install for that platform |
| `pulse_connect` | `source`: `revenuecat` \| `app_store` \| `google_play` | How to connect the revenue source for MRR / LTV / revenue |

Things the guides insist on:

- **Revenue, MRR and LTV come from connectors, not `track()`.** Purchase
  events never become revenue — connect the store/billing source instead.
- **App Store needs the Vendor Number** (App Store Connect → Payments and
  Financial Reports); without it the Sales & Trends sync fails.
- **App Store real-time is forward-not-replace.** Apple allows one Server
  Notifications URL per app — if your backend already uses it, forward a copy
  of the raw `{ signedPayload }` body to the Pulse hook instead of replacing
  your URL. Pulse re-verifies Apple's signature itself.

## What's intentionally not here

`pulse_verify` and `pulse_ask` need access to the Pulse API and database, so
they stay on the remote MCP server and in the web dashboard. The value of this
package is offline delivery of the install/connect guides.

## Development

```bash
npm run build -w @pulse-circle/mcp   # tsup → dist/index.js (the pulse-mcp bin)
npm test                             # includes the stdio smoke test
```

Release: tag `mcp-v<version>` — see [RELEASING.md](../../RELEASING.md).
