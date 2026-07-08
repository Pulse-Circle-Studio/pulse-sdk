import { describe, test } from 'vitest';
import { DEFAULT_ENDPOINT, PulseClient, SDK_VERSION, type PulseOptions } from '@pulse-circle/core';
import { runFixture, type FixtureClientFactory } from '@pulse-circle/core/testing';
import { loadFixtures } from './fixtures.js';

// The core client with mobile-like defaults; platform packages run their own
// conformance suites over the same fixtures.
const factory: FixtureClientFactory = (init, env) =>
  new PulseClient({
    apiKey: init.apiKey,
    options: init.options as PulseOptions,
    defaults: {
      endpoint: DEFAULT_ENDPOINT,
      flushAt: 20,
      flushIntervalMs: 30_000,
      maxQueueEvents: 5_000,
      debug: false,
    },
    sdk: { name: 'pulse-core', version: SDK_VERSION },
    transport: env.transport,
    clock: env.clock,
    keyValueStorage: env.kv,
    queueStorage: env.queue,
    random: () => 0.5, // deterministic mid-range jitter
  });

describe('protocol conformance (@pulse-circle/core)', () => {
  for (const fixture of loadFixtures(null)) {
    test(fixture.name, async () => {
      await runFixture(fixture, factory);
    });
  }
});
