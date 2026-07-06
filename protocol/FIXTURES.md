# Conformance fixtures — runner contract

Each JSON file in [`fixtures/`](./fixtures) is a scenario: a sequence of SDK
API calls interleaved with assertions about the HTTP requests the SDK must
produce and the responses the (mock) server returns. Every Pulse SDK ships a
**fixture runner** that executes these files in CI; the server monorepo
replays the same files against the real ingestion service. A fixture passes
identically on web, React Native, iOS, and Android unless it declares a
`platforms` restriction.

## Runner requirements

The runner drives a real client instance with three injected test doubles:

1. **Mock transport** — captures every outgoing request (method, path,
   headers, parsed JSON body) into a FIFO of *pending requests*; each
   `expectRequest` step pops the oldest pending request, matches it, and
   only then delivers the step's scripted response to the client. The
   client's in-flight request stays unresolved until then.
2. **Virtual clock** — controls both `now()` (event timestamps) and timers
   (flush interval, retry backoff). It starts at `2026-01-01T00:00:00.000Z`
   and only moves via `advance` steps, which fire any timers that come due,
   in order.
3. **In-memory storage** — substitutes for localStorage / files /
   SharedPreferences etc. It persists across `restart` steps within one
   fixture and is empty at fixture start.

Runners MUST fail a fixture if, at the end of the step list, any pending
request was never consumed by an `expectRequest`.

## Fixture file shape

```json
{
  "name": "snake_case_name",
  "description": "What this scenario proves.",
  "platforms": ["web"],
  "steps": [ ... ]
}
```

`platforms` is optional; when present, runners for other platforms skip the
fixture. Values: `web`, `react-native`, `ios`, `android`.

## Steps

| Step | Meaning |
|---|---|
| `{"do": "init", "apiKey": "pk_fixture", "options": { ... }}` | Create a client. `options` may set `flushAt`, `flushIntervalMs`, `maxQueueEvents` (test-only overrides of the platform defaults) and `debug`. |
| `{"do": "track", "event": "name", "properties": { ... }}` | Call `track`. `properties` optional. |
| `{"do": "trackMany", "count": 120, "event": "name", "indexProperty": "i"}` | Call `track` `count` times; call *n* (0-based) has properties `{"<indexProperty>": n}`. |
| `{"do": "identify", "userId": "u_1"}` | Call `identify`. |
| `{"do": "reset"}` | Call `reset`. |
| `{"do": "flush"}` | Call `flush`. |
| `{"do": "advance", "ms": 1300}` | Advance the virtual clock, firing due timers. |
| `{"do": "restart"}` | Drop the client instance without flushing (simulated process death), then re-create it with the same `init` arguments over the same storage. |
| `{"do": "expectRequest", "request": { ... }, "respond": { ... }}` | Pop the oldest pending request, match it (below), respond. |
| `{"do": "expectNoRequest"}` | Assert there is no pending request. |

`expectRequest.request` has `path` (exact), optional `headers` (subset match,
case-insensitive names, exact values), and optional `body` (matched per the
grammar below; when omitted, the body is not inspected).

After every step, the runner must let the client **settle** (drain the JS
microtask queue / sync the serial dispatch queue / run the test dispatcher
until idle) before evaluating the next step, so that `expectRequest` /
`expectNoRequest` observe a quiescent client. Delivering a response can
trigger the next request of a drain — that request becomes pending
immediately after settling.

`expectRequest.respond` is either `{"networkError": true}` (the transport
fails; no HTTP status) or `{"status": 200, "body": { ... }}`. Response bodies
may use the response templates below.

## Body matching

Expected and actual bodies are compared structurally and **strictly**: same
object keys (an omitted `user_id` means the actual event must not contain
`user_id`), same array lengths, same order. Numbers compare by value.
String values in the *expected* body starting with `$` are matchers:

| Matcher | Matches |
|---|---|
| `$uuid4` | A UUIDv4 string. |
| `$eventKey` | `evt_` + 26-char Crockford-base32 ULID. |
| `$identifyKey` | `idf_` + 26-char Crockford-base32 ULID. |
| `$isoTimestamp` | ISO-8601 UTC timestamp with milliseconds. |
| `$string` | Any non-empty string. |
| `$capture:<name>:<matcher>` | Matches `<matcher>` (one of the above, without `$`), and stores the actual value under `<name>` for the rest of the fixture. |
| `$same:<name>` | Exactly the value previously captured as `<name>`. |
| `$differs:<name>:<matcher>` | Matches `<matcher>` and the value is **not** equal to the capture `<name>`. |

A `batch` value may instead be the object
`{"$seq": {"event": "name", "indexProperty": "i", "start": 0, "count": 100}}`:
it matches a batch of exactly `count` track events whose event name is
`event`, whose `properties` are exactly `{"<indexProperty>": start + position}`
(proving order end-to-end), and whose other fields match the standard track
shape (`anonymous_id` → uuid4, `idempotency_key` → event key, `timestamp` →
ISO timestamp, no `user_id`).

## Response templates

Inside `respond.body`, these strings are replaced using the *matched* request:

| Template | Replacement |
|---|---|
| `$allKeys` | Array of every `idempotency_key` in the matched batch, in order. |
| `$key:<i>` | The `idempotency_key` of the i-th (0-based) batch item. |

## Server-side replay

The server repo's integration test materializes each fixture's *expected
requests* (instantiating matchers with concrete values — fresh UUIDs/ULIDs,
`timestamp` = now — and honouring `$capture`/`$same` identity), sends them to
the real ingestion API, and asserts: scripted `respond.status` 2xx fixtures
get a 2xx whose `accepted` contains every sent key. Fixtures whose scripted
responses are error statuses or `networkError` exercise client behaviour only
and are skipped by the replay where the real server cannot be made to produce
them; retryable-path fixtures still verify that re-sending an identical batch
is accepted idempotently (no duplicate rows).

## Adding a fixture

1. Add the JSON file here (this directory is the canonical copy).
2. Mirror it to `pulse-sdk-native/protocol/fixtures/` and the server repo —
   CI in both repos fails if the copies drift.
3. All four SDK runners and the server replay must pass it.
