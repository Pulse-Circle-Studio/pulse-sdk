import { describe, test } from 'vitest';
import { MemoryAsyncStorage, createReactNativeClient, type PulseOptions } from '@pulse/react-native';
import { runFixture, type FixtureClientFactory, type FixtureEnv } from '@pulse/core/testing';
import { loadFixtures } from '../../core/test/fixtures.js';

// Runs the shared fixtures through the REAL AsyncStorage adapters (async
// hydration path), backed by an in-memory AsyncStorage that survives the
// fixture's "restart" steps.
const storeByEnv = new WeakMap<FixtureEnv, MemoryAsyncStorage>();

const factory: FixtureClientFactory = (init, env) => {
  let store = storeByEnv.get(env);
  if (!store) {
    store = new MemoryAsyncStorage();
    storeByEnv.set(env, store);
  }
  return createReactNativeClient(init.apiKey, init.options as PulseOptions, {
    transport: env.transport,
    clock: env.clock,
    asyncStorage: store,
    appState: null,
    netInfo: null,
  });
};

describe('protocol conformance (@pulse/react-native)', () => {
  for (const fixture of loadFixtures('react-native')) {
    test(fixture.name, async () => {
      await runFixture(fixture, factory);
    });
  }
});
