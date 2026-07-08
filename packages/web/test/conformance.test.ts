import { describe, test } from 'vitest';
import { createWebClient, type PulseOptions } from '@pulse-circle/web';
import { runFixture, type FixtureClientFactory, type FixtureEnv } from '@pulse-circle/core/testing';
import { loadFixtures } from '../../core/test/fixtures.js';

// sessionStorage outlives a page reload (fixture "restart") but not a fixture.
const sessionsByEnv = new WeakMap<FixtureEnv, Map<string, string>>();

const factory: FixtureClientFactory = (init, env) => {
  let session = sessionsByEnv.get(env);
  if (!session) {
    session = new Map();
    sessionsByEnv.set(env, session);
  }
  return createWebClient(init.apiKey, init.options as PulseOptions, {
    transport: env.transport,
    clock: env.clock,
    keyValueStorage: env.kv,
    queueStorage: env.queue,
    sessionFlags: { get: (k) => session.get(k) ?? null, set: (k, v) => session.set(k, v) },
    pageUrl: init.pageUrl ?? 'https://app.example.test/',
    skipPageListeners: true,
  });
};

describe('protocol conformance (@pulse-circle/web)', () => {
  for (const fixture of loadFixtures('web')) {
    test(fixture.name, async () => {
      await runFixture(fixture, factory);
    });
  }
});
