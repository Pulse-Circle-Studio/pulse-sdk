import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_ENDPOINT,
  PulseClient,
  SDK_VERSION,
  sanitizeProperties,
  ulid,
  uuid4,
  type PulseClientConfig,
  type PulseLogger,
} from '@pulse/core';
import {
  InMemoryKeyValueStorage,
  InMemoryQueueStorage,
  MockTransport,
  VirtualClock,
  settle,
} from '@pulse/core/testing';

function makeClient(overrides: Partial<PulseClientConfig> = {}) {
  const transport = new MockTransport();
  const clock = new VirtualClock();
  const kv = new InMemoryKeyValueStorage();
  const queue = new InMemoryQueueStorage();
  const client = new PulseClient({
    apiKey: 'pk_test',
    defaults: {
      endpoint: DEFAULT_ENDPOINT,
      flushAt: 20,
      flushIntervalMs: 30_000,
      maxQueueEvents: 5_000,
      debug: false,
    },
    sdk: { name: 'pulse-core', version: SDK_VERSION },
    transport,
    clock,
    keyValueStorage: kv,
    queueStorage: queue,
    random: () => 0.5,
    ...overrides,
  });
  return { client, transport, clock, kv, queue };
}

describe('batch body size limit', () => {
  test('splits batches so each body stays under 512 KB', async () => {
    const { client, transport } = makeClient({
      options: { flushAt: 1_000, flushIntervalMs: 3_600_000 },
    });
    await settle();
    const bigValue = 'x'.repeat(300 * 1024);
    for (let i = 0; i < 3; i++) client.track('big', { i, payload: bigValue });
    client.flush();
    await settle();

    const sizes: number[] = [];
    for (let round = 0; round < 3; round++) {
      const pending = transport.shift();
      expect(pending, `request ${round}`).toBeDefined();
      expect(Buffer.byteLength(pending!.request.body, 'utf8')).toBeLessThanOrEqual(512 * 1024);
      const body = JSON.parse(pending!.request.body) as { batch: unknown[] };
      sizes.push(body.batch.length);
      pending!.callback({
        ok: true,
        status: 200,
        body: JSON.stringify({ accepted: [], rejected: [] }),
      });
      await settle();
    }
    expect(sizes).toEqual([1, 1, 1]);
    expect(transport.pending).toHaveLength(0);
  });
});

describe('retry backoff', () => {
  test('delays are base*2^n with ±20% jitter, capped at 5 minutes', async () => {
    const delays: number[] = [];
    const clock = new VirtualClock();
    const recordingClock = {
      nowMs: () => clock.nowMs(),
      schedule: (afterMs: number, work: () => void) => {
        delays.push(afterMs);
        return clock.schedule(afterMs, work);
      },
    };
    const { client, transport } = makeClient({
      clock: recordingClock,
      options: { flushAt: 1_000, flushIntervalMs: 86_400_000 * 30 },
      random: () => 1, // max jitter: +20%
    });
    await settle();
    client.track('e');
    client.flush();
    await settle();

    // 9 failures → 9 retry delays (the 10th failure moves the batch to the tail).
    for (let attempt = 1; attempt <= 9; attempt++) {
      const pending = transport.shift();
      expect(pending, `attempt ${attempt}`).toBeDefined();
      pending!.callback({ ok: false, error: new Error('offline') });
      await settle();
      await clock.advance(400_000);
    }

    const retryDelays = delays.filter((d) => d !== 86_400_000 * 30);
    expect(retryDelays).toHaveLength(9);
    const bases = [1, 2, 4, 8, 16, 32, 64, 128, 256].map((s) => s * 1000);
    retryDelays.forEach((delay, i) => {
      expect(delay).toBe(Math.round(Math.min(bases[i]!, 300_000) * 1.2));
    });
  });
});

describe('401 handling', () => {
  test('invalid API key is logged once per client, batches dropped', async () => {
    const errors: string[] = [];
    const logger: PulseLogger = { debug: () => {}, error: (m) => errors.push(m) };
    const { client, transport } = makeClient({ logger });
    await settle();

    for (const event of ['a', 'b']) {
      client.track(event);
      client.flush();
      await settle();
      const pending = transport.shift();
      expect(pending).toBeDefined();
      pending!.callback({ ok: true, status: 401, body: JSON.stringify({ error: 'unauthorized' }) });
      await settle();
    }
    expect(errors.filter((e) => e.includes('API key'))).toHaveLength(1);
    expect(transport.pending).toHaveLength(0);
  });
});

describe('ulid', () => {
  test('shape, uniqueness, and time ordering', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1_000; i++) {
      const id = ulid(1_735_689_600_000);
      expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      seen.add(id);
    }
    expect(seen.size).toBe(1_000);
    // Same millisecond → same 10-char time prefix.
    const prefixes = new Set([...seen].map((id) => id.slice(0, 10)));
    expect(prefixes.size).toBe(1);
    // Later time sorts lexicographically after earlier time.
    expect(ulid(2_000_000_000_000).slice(0, 10) > ulid(1_000_000_000_000).slice(0, 10)).toBe(true);
  });

  test('uuid4 shape', () => {
    expect(uuid4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('property sanitization', () => {
  const logger: PulseLogger = { debug: () => {}, error: () => {} };

  test('drops unsupported types and deep nesting, keeps the rest', () => {
    const result = sanitizeProperties(
      {
        str: 's',
        num: 1.5,
        bool: true,
        nul: null,
        nested: { a: { b: 1 } },
        arr: [1, 2, ['deep-ok']],
        tooDeep: { a: { b: { c: 1 } } },
        fn: () => {},
        nan: Number.NaN,
        undef: undefined,
      },
      logger,
      false,
    );
    expect(result).toEqual({
      str: 's',
      num: 1.5,
      bool: true,
      nul: null,
      nested: { a: { b: 1 } },
      arr: [1, 2, ['deep-ok']],
    });
  });
});

describe('version constant', () => {
  test('matches package.json', () => {
    const pkg = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8'),
    ) as { version: string };
    expect(SDK_VERSION).toBe(pkg.version);
  });
});
