# @pulse/react-native

Add analytics to your React Native or Expo app. A reliable, offline-first
event queue and identity — **pure JavaScript, no native modules**, so
installation is just an `npm install` and it works in Expo Go.

- Persistent queue over AsyncStorage; idempotent, ordered delivery that
  survives app restarts and offline periods.
- Flushes when the app goes to the background and (optionally) the moment
  connectivity returns.
- Sends nothing automatically — no screen auto-tracking, no device ids, no
  fingerprinting.

## Install

```bash
npm install @pulse/react-native @react-native-async-storage/async-storage
```

`@react-native-async-storage/async-storage` is a peer dependency (it's what
persists the queue across launches).
[`@react-native-community/netinfo`](https://github.com/react-native-netinfo/react-native-netinfo)
is optional — if present, the SDK flushes as soon as the network returns;
without it, the built-in retry backoff recovers on its own.

## Quickstart

```ts
import { Pulse } from '@pulse/react-native';

Pulse.init('pk_your_api_key');

Pulse.track('screen_opened', { screen: 'Home' });

// After login:
Pulse.identify('user_42');

// On logout:
Pulse.reset();
```

## API

The API is identical to every other Pulse SDK.

### `Pulse.init(apiKey, options?)`

```ts
Pulse.init('pk_...', {
  endpoint: 'https://api.pulse.pulsecircle.studio',
  flushIntervalMs: 30_000, // default: 30 s on mobile
  debug: false,
});
```

### `Pulse.track(event, properties?)`

Queue an event. `properties` is a plain object of primitives, nested up to two
levels deep (deeper values are dropped with a debug warning).

### `Pulse.identify(userId)`

Associate the current identity with your user id; sent once per
(anonymous id, user id) pair.

### `Pulse.reset()`

Log out and mint a new anonymous id. Queued events keep their original
identity.

### `Pulse.flush()`

Force-send the queue. The SDK also flushes on a size trigger (20 events), a
timer, and when the app backgrounds.

## How delivery works

- `idempotency_key` and `timestamp` are fixed when you call `track`; retries
  resend them unchanged, so retries never duplicate events.
- The queue is persisted through AsyncStorage (cap 5,000 events; oldest
  evicted first past the cap) and delivered in order.
- Failed batches retry with exponential backoff and jitter; a persistently
  rejected batch is set aside after 10 attempts so it never blocks the queue.

## Advanced: a scoped client

```ts
import { createReactNativeClient } from '@pulse/react-native';

const client = createReactNativeClient('pk_...', { debug: true });
client.track('event');
```

`createReactNativeClient` also accepts overrides (transport, clock, storage,
AppState, NetInfo) for testing.

## License

MIT © Pulse Circle Studio
