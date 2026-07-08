import { describe, expect, test } from 'vitest';
import { Pulse, createWebClient, type PulseOptions } from '@pulse-circle/web';
import {
  InMemoryKeyValueStorage,
  InMemoryQueueStorage,
  MockTransport,
  VirtualClock,
  settle,
} from '@pulse-circle/core/testing';

describe('SSR safety', () => {
  test('importing and calling the API without window is a no-op', () => {
    expect(typeof window).toBe('undefined');
    expect(() => {
      Pulse.init('pk_ssr');
      Pulse.track('server_render');
      Pulse.identify('u');
      Pulse.reset();
      Pulse.flush();
    }).not.toThrow();
  });
});

describe('UTM capture', () => {
  function make(pageUrl: string, session: Map<string, string>) {
    const env = {
      transport: new MockTransport(),
      clock: new VirtualClock(),
      kv: new InMemoryKeyValueStorage(),
      queue: new InMemoryQueueStorage(),
    };
    const client = createWebClient('pk_test', { flushIntervalMs: 3_600_000 } as PulseOptions, {
      transport: env.transport,
      clock: env.clock,
      keyValueStorage: env.kv,
      queueStorage: env.queue,
      sessionFlags: { get: (k) => session.get(k) ?? null, set: (k, v) => session.set(k, v) },
      pageUrl,
      skipPageListeners: true,
    });
    return { client, env };
  }

  test('captured once per session, even across reloads with UTM still in the URL', async () => {
    const session = new Map<string, string>();
    const url = 'https://x.test/?utm_source=news&utm_term=q2';
    const first = make(url, session);
    await settle();
    first.client.track('one');
    first.client.flush();
    await settle();
    let req = first.env.transport.shift()!;
    let body = JSON.parse(req.request.body) as { context: { utm?: unknown } };
    expect(body.context.utm).toEqual({ source: 'news', term: 'q2' });
    req.callback({ ok: true, status: 200, body: '{"accepted":[],"rejected":[]}' });
    await settle();
    first.client.dispose();

    // Reload in the same session: the flag is set, no re-capture.
    const second = make(url, session);
    await settle();
    second.client.track('two');
    second.client.flush();
    await settle();
    req = second.env.transport.shift()!;
    body = JSON.parse(req.request.body) as { context: { utm?: unknown } };
    expect(body.context.utm).toBeUndefined();
    req.callback({ ok: true, status: 200, body: '{"accepted":[],"rejected":[]}' });
    await settle();
  });

  test('pending UTM survives an unload before the first flush', async () => {
    const session = new Map<string, string>();
    const kvBacking = new InMemoryKeyValueStorage();
    const env = {
      transport: new MockTransport(),
      clock: new VirtualClock(),
      queue: new InMemoryQueueStorage(),
    };
    const overrides = {
      transport: env.transport,
      clock: env.clock,
      keyValueStorage: kvBacking,
      queueStorage: env.queue,
      sessionFlags: {
        get: (k: string) => session.get(k) ?? null,
        set: (k: string, v: string) => session.set(k, v),
      },
      skipPageListeners: true,
    };
    const first = createWebClient('pk_test', { flushIntervalMs: 3_600_000 }, {
      ...overrides,
      pageUrl: 'https://x.test/?utm_source=ads',
    });
    await settle();
    first.track('never_flushed');
    first.dispose(); // page dies before any flush

    const second = createWebClient('pk_test', { flushIntervalMs: 3_600_000 }, {
      ...overrides,
      pageUrl: 'https://x.test/inner', // navigation lost the params
    });
    await settle();
    second.flush();
    await settle();
    const req = env.transport.shift()!;
    const body = JSON.parse(req.request.body) as { context: { utm?: unknown } };
    expect(body.context.utm).toEqual({ source: 'ads' });
    req.callback({ ok: true, status: 200, body: '{"accepted":[],"rejected":[]}' });
    await settle();
  });
});
