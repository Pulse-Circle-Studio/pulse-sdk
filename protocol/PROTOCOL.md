# Pulse SDK Wire Protocol — v1

**Protocol version:** `1` (sent as the `X-Pulse-Protocol: 1` request header)
**Status:** normative. This document is the source of truth for every Pulse SDK
(web, React Native, iOS, Android). The JSON fixtures under
[`fixtures/`](./fixtures) are the executable form of this contract — see
[FIXTURES.md](./FIXTURES.md).

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as in
RFC 2119.

---

## 1. Scope and philosophy

A Pulse SDK does exactly two things:

1. **A reliable, ordered, persistent event queue** with idempotent delivery.
2. **Identity** (anonymous id → `identify` → `reset`).

No auto-capture, no session replay, no lifecycle magic. Everything in this
document exists to make those two things survive offline periods, process
death, retries, and hostile networks without ever duplicating or losing an
event (within the documented queue caps).

## 2. Transport

- All requests are `POST` over HTTPS to the configured endpoint
  (default: `https://api.pulse.pulsecircle.studio`).
- Headers on every request:

  | Header | Value |
  |---|---|
  | `Authorization` | `Bearer <api key>` (keys look like `pk_…`) |
  | `Content-Type` | `application/json` |
  | `X-Pulse-Protocol` | `1` |

- Request bodies are UTF-8 JSON. Server body limit is 1 MB; SDKs MUST keep
  batch bodies ≤ **512 KB** (see §7).
- At most **one request in flight per client instance** at any time. The queue
  has a single writer; this is what makes ordering and retry semantics simple
  enough to be correct on four platforms.

## 3. `POST /v1/batch`

### Request

```json
{
  "batch": [ <event>, ... ],
  "context": {
    "sdk": { "name": "pulse-web", "version": "0.1.0" },
    "utm": { "source": "...", "medium": "...", "campaign": "...", "content": "...", "term": "..." }
  }
}
```

- `batch`: 1–100 events (server hard-caps at 1,000; the SDK limit is 100).
- `context.sdk` MUST be present on every request: `name` is the platform
  package name (`pulse-web`, `pulse-react-native`, `pulse-ios`,
  `pulse-android`), `version` is the SDK semver.
- `context.utm` MAY be present (web only, see §9). All keys optional.

### Event object

```json
{
  "type": "track",
  "anonymous_id": "9f0b6c1e-...-uuid-v4",
  "user_id": "user-42",
  "event": "subscription_started",
  "properties": { "plan": "pro" },
  "idempotency_key": "evt_01HV5X2Q8ZJ4T9GXKM3W7NBCDE",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

| Field | Rule |
|---|---|
| `type` | Always `"track"` in protocol 1. |
| `anonymous_id` | UUIDv4 of the identity **at the time `track` was called**. Always present. ≤ 255 chars. |
| `user_id` | Present only if the identity had been identified when `track` was called. Omitted (not `null`) otherwise. ≤ 255 chars. |
| `event` | Event name as passed by the caller. 1–255 chars. |
| `properties` | JSON object. Values are primitives (string/number/boolean/null), or objects/arrays nested at most 2 levels deep. The SDK MUST drop deeper values with a debug warning rather than reject the event. Defaults to `{}`. |
| `idempotency_key` | `evt_` + ULID (26 chars, Crockford base32). Generated **at the moment `track()` is called** — never at send time. |
| `timestamp` | Client wall-clock time **at the moment `track()` is called**, ISO-8601 UTC with milliseconds (`YYYY-MM-DDTHH:mm:ss.sssZ`). |

**The idempotency invariant (the most important rule in this document):**
an event is serialized exactly once, when it is enqueued. Any retry of a batch
resends byte-identical `idempotency_key` **and** `timestamp` values. The
server's primary key includes both; a drifting timestamp on retry creates a
duplicate row. Sending never mutates an event.

### Response

`200 OK`:

```json
{
  "accepted": ["evt_...", "evt_..."],
  "rejected": [ { "key": "evt_...", "reason": "timestamp_in_future" } ]
}
```

- The server validates per item. A 200 response with entries in `rejected`
  is **terminal** for those items: rejection is deterministic, the SDK MUST
  NOT retry rejected items. It SHOULD log them in debug mode.
- Server-side timestamp bounds (rejection reasons, for reference): more than
  5 minutes in the future, or older than 90 days.

### Status handling

| Status | SDK behaviour |
|---|---|
| 2xx | Remove the batch from the queue. Debug-log `rejected[]`. |
| 408, 429, 5xx, network/transport error | Retryable: keep the batch at the head of the queue, exponential backoff (§8). |
| 401 | Drop the batch. Log an "invalid API key" error **once per client instance** — not per batch. |
| Other 4xx | Drop the batch with an error log. Rejection is deterministic; retrying cannot succeed. |

## 4. `POST /v1/identify`

### Request

```json
{
  "anonymous_id": "9f0b6c1e-...",
  "user_id": "user-42",
  "idempotency_key": "idf_01HV5X2Q8ZJ4T9GXKM3W7NBCDE"
}
```

- `idempotency_key` is `idf_` + ULID, generated when `identify()` is called.
  (Server-side idempotency of identify comes from merge no-op semantics; the
  key is part of the wire contract for uniformity and log correlation.)
- Response: `200` with `{ "status": "ok", "canonical_user_id": "..." }`.
  The SDK ignores the body.
- Status handling is the same table as §3.

### Dedup

The SDK MUST send `/v1/identify` **at most once per
(`anonymous_id`, `user_id`) pair**, deduplicated locally and persistently
(the dedup set survives process restart). Calling `identify` again with the
same user id against the same anonymous id enqueues nothing.

## 5. Identity lifecycle

- **`anonymous_id`**: UUIDv4, generated on first `init`, persisted
  (localStorage / UserDefaults / SharedPreferences / AsyncStorage). Lives
  until `reset()`.
- **`identify(userId)`**: from this moment, newly tracked events carry
  `user_id` **and** `anonymous_id`. `user_id` is persisted and survives
  restarts. Traits are reserved in v1 — only the user id is sent.
- **`reset()`**: generates and persists a new `anonymous_id`, clears
  `user_id` and does not touch the identify-dedup set. Events already in the
  queue keep the identity they were tracked under — the tail of the old
  user's queue drains with the old identity.

Identity is stamped onto the event **at enqueue time**. Later `identify` or
`reset` calls never rewrite queued events.

## 6. Queue

- One totally ordered queue per client, containing track events and identify
  records. Delivery preserves enqueue order (per §7 segmentation).
- **Persistent**: the queue survives process restart.
  - Web: localStorage, cap **1,000** events.
  - Mobile (RN / iOS / Android): file-backed append-log with compaction,
    cap **5,000** events.
- **FIFO eviction**: when the cap is reached, the oldest queued item that is
  not part of an in-flight batch is dropped to make room, with a debug
  warning. Never crash, never block the caller.
- **Offline**: events accumulate up to the cap. When connectivity returns,
  delivery resumes in order.
- **Single writer**: all queue mutation happens on one serial executor
  (serial DispatchQueue / single-threaded coroutine dispatcher / the JS event
  loop). All public API methods are safe to call from any thread; they hand
  off to the executor and return.

## 7. Batching and flush

Flush triggers (any of):

1. Queue reaches **20** events.
2. Timer: **10 s** (web) / **30 s** (mobile) after the first unflushed event.
3. Explicit `flush()`.
4. App going to background (mobile: lifecycle hook, best effort) / page
   becoming hidden (web: `visibilitychange`, see §10).

A flush **drains** the queue: after each successful request, if items remain,
the next request is sent immediately, until the queue is empty or a retryable
error pauses it. Flush triggers (including explicit `flush()`) that fire
while a retry backoff is pending, or while a request is in flight, are no-ops
— the backoff schedule governs the pinned batch; nothing overtakes it.

Batch construction, from the head of the queue:

- If the head item is an identify record → one `/v1/identify` request with
  exactly that item.
- Otherwise → take the longest run of consecutive track events from the head,
  up to **100 events** and **512 KB** of body, → one `/v1/batch` request.
  (An identify record in the queue therefore splits batches; this is what
  keeps ordering exact.)

**Batch pinning:** once a batch has been sent and failed retryably, retries
resend **exactly the same items** — the batch does not grow to absorb newer
events, and the events are the same serialized bytes (§3). Pinning is
in-memory; after a process restart batches are re-formed from the persisted
queue (the idempotency keys make any overlap harmless).

## 8. Retry

- Backoff schedule for retryable failures (§3 table): 1 s, 2 s, 4 s, …
  doubling to a ceiling of **5 minutes**, each delay jittered ±20%.
- The failed batch stays at the head; nothing behind it is attempted while it
  waits (single in-flight rule).
- **Poison-batch protection:** after **10 consecutive failed attempts**, the
  batch moves to the **tail** of the queue as a pinned unit (it is never
  merged with newer events; attempt counter reset) and the next batch is
  attempted immediately. One un-ingestible batch must never
  block the queue forever.
- No retry ever regenerates keys or timestamps.

## 9. Context capture

- `context.sdk = { name, version }` on every `/v1/batch` request (§3);
  `/v1/identify` bodies carry no context.
- **Web only:** on the first page load of a session (per sessionStorage), the
  SDK captures `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`,
  `utm_term` from the page URL — once. The captured object is attached as
  `context.utm` to the **next** `/v1/batch` request, then cleared. The
  pending capture is persisted so a page unload before the first flush does
  not lose it.
- **Nothing else is collected.** No IDFA/GAID, no geolocation, no
  fingerprinting, no automatic PII. Empty by default is part of the product.

## 10. Platform notes

- **Web:** on `visibilitychange` → `hidden` (and `pagehide`), the SDK issues
  a best-effort flush using `fetch(…, { keepalive: true })` (which carries
  the auth header; `navigator.sendBeacon` cannot). The flush is
  fire-and-forget: events stay queued until a 2xx is observed, so if the page
  dies first, the next page load re-sends them and the server dedupes by
  idempotency key + timestamp. SSR: importing the SDK without `window` MUST
  be a safe no-op.
- **Mobile:** background transition triggers a best-effort flush via the
  platform lifecycle hook. No background URLSession / WorkManager in v1 —
  the persistent queue makes restart-delivery sufficient.

## 11. Conformance

Every SDK runs the shared fixtures in CI via its fixture runner; the server
repo replays the same fixtures against the real ingestion service. See
[FIXTURES.md](./FIXTURES.md) for the runner contract, and the per-repo READMEs
for how to run them locally.
