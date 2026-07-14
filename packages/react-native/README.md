# @pulse-circle/react-native

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
npm install @pulse-circle/react-native @react-native-async-storage/async-storage
```

`@react-native-async-storage/async-storage` is a peer dependency (it's what
persists the queue across launches).
[`@react-native-community/netinfo`](https://github.com/react-native-netinfo/react-native-netinfo)
is optional — if present, the SDK flushes as soon as the network returns;
without it, the built-in retry backoff recovers on its own.

## Quickstart

```ts
import { Pulse } from '@pulse-circle/react-native';

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

## Subscriptions & revenue

This SDK sends product events, not revenue. To get MRR / LTV / refunds, connect
your billing in Pulse (RevenueCat, Apple App Store, or Google Play) — don't send
purchases as `track()` calls. Keep the user id consistent: `Pulse.identify(userId)`
on the client and the same id as your store/RevenueCat `app_user_id`.

### Apple App Store subscriptions

Revenue, MRR and LTV for App Store come from **Server Notifications v2**, which
Pulse ingests through its App Store hook. Apple allows only one notifications URL
per app — if your backend already consumes it, forward a copy (don't replace):

```js
// Apple → your backend → Pulse. Forward the raw { signedPayload } body.
app.post('/your/app-store/notifications', (req, res) => {
  res.sendStatus(200);               // ack Apple first
  fetch('https://hooks.pulse.pulsecircle.studio/hooks/app-store/YOUR_CONNECTION_ID', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req.body),  // the { signedPayload } Apple sent
  }).catch(() => {});                // Pulse re-verifies Apple's signature
});
```

Do the same from your sandbox handler (same URL). Get `YOUR_CONNECTION_ID` from
the App Store card in Pulse → Connections. Sales & Trends reports alone give
store-level revenue with a 24–48h delay but not per-subscription MRR/LTV.

## Advanced: a scoped client

```ts
import { createReactNativeClient } from '@pulse-circle/react-native';

const client = createReactNativeClient('pk_...', { debug: true });
client.track('event');
```

`createReactNativeClient` also accepts overrides (transport, clock, storage,
AppState, NetInfo) for testing.

## License

MIT © Pulse Circle Studio
