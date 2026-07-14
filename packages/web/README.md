# @pulse-circle/web

Add analytics to your web app in two lines. A reliable, offline-first event
queue and identity for the browser — **≤ 10 KB gzipped, zero dependencies**.

- Persistent queue (survives reloads and offline periods) with idempotent,
  ordered delivery.
- Sends nothing automatically: no page-view auto-capture, no fingerprinting,
  no ad SDKs. You track what you choose to track.
- ESM, CommonJS, and a `<script>` global build. TypeScript types included.
  SSR-safe (a no-op when there's no `window`).

## For AI agents
Install: `npm i @pulse-circle/web`, then `Pulse.init('pk_...')` and
`Pulse.track('event', {...})`. The package is self-contained (zero deps, default
endpoint baked in) and ships llms.txt inside it. Installing needs only npm; event
delivery happens in the end-user's browser at runtime.

Agent-readable guide (reachable behind sandbox allow-lists):
https://raw.githubusercontent.com/Pulse-Circle-Studio/pulse-sdk/main/llms.txt

## Install

```bash
npm install @pulse-circle/web
```

Or drop in a script tag — the bundle exposes a global `Pulse`:

```html
<script src="https://cdn.jsdelivr.net/npm/@pulse-circle/web/dist/pulse.iife.global.js"></script>
```

## Quickstart

```ts
import { Pulse } from '@pulse-circle/web';

Pulse.init('pk_your_api_key');

Pulse.track('signup_completed', { plan: 'pro', referred: true });

// After the user logs in:
Pulse.identify('user_42');

// On logout:
Pulse.reset();
```

## API

### `Pulse.init(apiKey, options?)`

Initialize once (typically at app startup). Safe to call before the DOM is
ready. On the server (no `window`) every method is a no-op, so importing this
in an SSR framework is safe.

```ts
Pulse.init('pk_...', {
  endpoint: 'https://api.pulse.pulsecircle.studio', // override for self-hosting
  flushIntervalMs: 10_000, // default: flush the queue every 10 s
  debug: false,            // log queue activity, rejected events, evictions
});
```

### `Pulse.track(event, properties?)`

Queue an event. `properties` is a plain object of primitives; objects/arrays
may be nested up to two levels deep (deeper values are dropped with a debug
warning, never a thrown error).

```ts
Pulse.track('checkout_started', { cart_value: 42.0, currency: 'USD' });
```

### `Pulse.identify(userId)`

Associate the current identity with your user id. From this point events carry
both the user id and the anonymous id. Sent to the server once per
(anonymous id, user id) pair.

### `Pulse.reset()`

Log out: mint a new anonymous id. Events already queued under the previous
user keep their identity.

### `Pulse.flush()`

Force-send the queue immediately. Useful in tests and right before a critical
moment. You rarely need this — the SDK also flushes on a size trigger
(20 events), a timer, and when the page is hidden.

## How delivery works

- Each event's `idempotency_key` and `timestamp` are set **when you call
  `track`**, not at send time. Retries resend them byte-identical, so a flaky
  network never produces duplicates.
- The queue is persisted to `localStorage` (cap 1,000 events; oldest evicted
  first past the cap) and delivered in order.
- Failed batches retry with exponential backoff and jitter; a persistently
  rejected batch is set aside after 10 attempts so it can't block the rest.
- When the page becomes hidden, a best-effort flush uses `fetch(..., {
  keepalive: true })`. If the page dies first, the events are still queued and
  go out on the next load — deduplicated server-side.

## UTM capture

On the first page load of a session, `@pulse-circle/web` reads `utm_source`,
`utm_medium`, `utm_campaign`, `utm_content`, and `utm_term` from the URL and
attaches them to the first batch as attribution context — once per session,
nothing more.

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

`Pulse` is a convenient singleton. If you need multiple isolated clients (or
full control over storage/transport in tests), use `createWebClient`:

```ts
import { createWebClient } from '@pulse-circle/web';

const client = createWebClient('pk_...', { debug: true });
client.track('event');
```

## License

MIT © Pulse Circle Studio
