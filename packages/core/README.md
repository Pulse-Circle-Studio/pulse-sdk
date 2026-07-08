# @pulse-circle/core

The platform-agnostic engine behind the Pulse SDKs. It implements the
[Pulse wire protocol](https://github.com/Pulse-Circle-Studio/pulse-sdk/blob/main/protocol/PROTOCOL.md)
— the persistent ordered queue, batching, idempotent retry, and identity
lifecycle — with **no DOM and no React Native APIs**. Everything
platform-specific (storage, transport, clock) is injected.

Most apps should install [`@pulse-circle/web`](https://www.npmjs.com/package/@pulse-circle/web)
or [`@pulse-circle/react-native`](https://www.npmjs.com/package/@pulse-circle/react-native)
instead. Use `@pulse-circle/core` directly only when porting Pulse to a new
JavaScript runtime.

## Install

```bash
npm install @pulse-circle/core
```

## What it does

`PulseClient` owns the whole protocol state machine. You give it four seams:

```ts
import { PulseClient, DEFAULT_ENDPOINT, SDK_VERSION } from '@pulse-circle/core';

const client = new PulseClient({
  apiKey: 'pk_...',
  defaults: {
    endpoint: DEFAULT_ENDPOINT,
    flushAt: 20,
    flushIntervalMs: 30_000,
    maxQueueEvents: 5_000,
    debug: false,
  },
  sdk: { name: 'pulse-myplatform', version: SDK_VERSION },
  transport,        // PulseTransport: how requests go out
  clock,            // PulseClock: now() + timer scheduling
  keyValueStorage,  // PulseKeyValueStorage: identity persistence
  queueStorage,     // PulseQueueStorage: the durable event queue
});

client.track('event', { key: 'value' });
client.identify('user_42');
client.reset();
client.flush();
```

Because time and I/O are injected, the client is fully deterministic under
test — no real timers, no real network.

## Testing utilities

`@pulse-circle/core/testing` ships the test doubles and the **conformance fixture
runner** used by every platform:

```ts
import {
  MockTransport,
  VirtualClock,
  InMemoryKeyValueStorage,
  InMemoryQueueStorage,
  runFixture,
} from '@pulse-circle/core/testing';
```

`runFixture(fixture, createClient)` drives a client through a protocol
scenario (see
[FIXTURES.md](https://github.com/Pulse-Circle-Studio/pulse-sdk/blob/main/protocol/FIXTURES.md))
and asserts the exact HTTP requests it produces. Porting Pulse to a new
runtime means: implement the four seams, then pass every fixture.

## License

MIT © Pulse Circle Studio
