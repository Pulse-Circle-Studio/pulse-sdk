# Pulse SDK

Open-source analytics SDKs for **web**, **React Native**, **iOS**, and
**Android**. Add analytics to your app with a reliable, offline-first event
queue and clean identity — and nothing else.

- **Tiny.** The web SDK is **≤ 10 KB gzipped** with **zero dependencies**.
- **Reliable.** A persistent, ordered queue survives offline periods and
  process death. Delivery is idempotent: retries never duplicate events.
- **Honest about privacy.** No auto-capture, no fingerprinting, no IDFA/GAID,
  no ad SDKs. The SDK sends only the events you send it.
- **One protocol, four platforms.** Every SDK implements the same
  [wire protocol](./protocol/PROTOCOL.md) and passes the same
  [conformance fixtures](./protocol/fixtures) in CI. The Pulse ingestion
  server replays those same fixtures — the contract is verified from both
  ends.

This repository holds the TypeScript packages. The Swift and Kotlin SDKs live
in [`pulse-sdk-native`](https://github.com/Pulse-Circle-Studio/pulse-sdk-native).

## Packages

| Package | What it's for | Install |
|---|---|---|
| [`@pulse/web`](./packages/web) | Browser / any web app | `npm i @pulse/web` |
| [`@pulse/react-native`](./packages/react-native) | React Native & Expo | `npm i @pulse/react-native` |
| [`@pulse/core`](./packages/core) | Platform-agnostic engine (used by the above) | `npm i @pulse/core` |

## Quickstart (web)

```bash
npm install @pulse/web
```

```ts
import { Pulse } from '@pulse/web';

Pulse.init('pk_your_api_key');

// Track product events — the SDK batches, persists, and retries for you.
Pulse.track('subscription_started', { plan: 'pro' });

// Tie events to a user after login.
Pulse.identify('user_42');

// On logout, start a fresh anonymous identity.
Pulse.reset();
```

That's the whole API. See each package's README for the platform-specific
install (script tag, Expo, etc.) and the full reference.

## The API, everywhere

The five methods are identical across all four platforms, in each language's
idiomatic syntax:

```
init(apiKey, options?)      // configure once
track(event, properties?)   // queue an event
identify(userId)            // associate the current identity with a user id
reset()                     // logout: new anonymous identity
flush()                     // force-send the queue (tests, critical moments)
```

There are deliberately no screen/page auto-tracking and no revenue methods:
revenue comes from server-side connectors, so there is exactly one source of
truth per number.

## The reliability contract

- Every event gets an `idempotency_key` and a `timestamp` **at the moment you
  call `track`** — never at send time. Retries resend both **byte-identical**,
  and the server's primary key includes both, so a flaky network can never
  create a duplicate.
- The queue is persistent (localStorage on web, files on mobile) and ordered.
  It survives reloads, crashes, and offline periods up to a per-platform cap,
  then evicts oldest-first with a debug warning rather than growing without
  bound.
- Retries use exponential backoff with jitter. A batch the server keeps
  rejecting (a "poison" batch) is moved aside after 10 attempts so it can
  never block everything behind it.

The normative details are in [`protocol/PROTOCOL.md`](./protocol/PROTOCOL.md).

## Development

```bash
npm install
npm test          # conformance fixtures + unit tests (vitest)
npm run lint
npm run typecheck
npm run build     # tsup builds for every package
npm run size -w @pulse/web   # enforce the 10 KB budget
```

### Conformance fixtures

[`protocol/fixtures`](./protocol/fixtures) is the source of truth for
cross-platform behaviour. Each JSON file is a scenario ("these API calls
produce these HTTP requests"); every SDK runs them through a shared
[fixture runner](./protocol/FIXTURES.md), and the server replays them against
real ingestion. Change behaviour by changing a fixture, and every platform's
CI tells you who's out of contract.

## Releasing

Versions are independent per package. Bump the version in the package's
`package.json`, then push a tag:

```
core-v0.1.0 | web-v0.1.0 | react-native-v0.1.0
```

The [publish workflow](./.github/workflows/publish.yml) verifies the tag
matches `package.json`, runs the full test + build + size gate, and publishes
to npm with provenance.

## License

MIT © Pulse Circle Studio
