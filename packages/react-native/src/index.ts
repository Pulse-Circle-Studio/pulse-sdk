import {
  DEFAULT_ENDPOINT,
  PulseClient,
  SDK_VERSION,
  type PulseCancellable,
  type PulseClock,
  type PulseOptions,
  type PulseProperties,
  type PulseTransport,
} from '@pulse-circle/core';
import {
  AsyncKeyValueStorage,
  AsyncQueueStorage,
  MemoryAsyncStorage,
  type AsyncStorageLike,
} from './storage.js';

export type { PulseOptions, PulseProperties };
export { AsyncKeyValueStorage, AsyncQueueStorage, MemoryAsyncStorage };
export type { AsyncStorageLike };

const RN_DEFAULTS = {
  endpoint: DEFAULT_ENDPOINT,
  flushAt: 20,
  flushIntervalMs: 30_000,
  maxQueueEvents: 5_000,
  debug: false,
};

interface AppStateLike {
  addEventListener(type: 'change', handler: (state: string) => void): unknown;
}

interface NetInfoLike {
  addEventListener(handler: (state: { isConnected?: boolean | null }) => void): unknown;
}

/** Injection points for tests; production wires real RN modules. */
export interface ReactNativeClientOverrides {
  transport?: PulseTransport;
  clock?: PulseClock;
  asyncStorage?: AsyncStorageLike;
  appState?: AppStateLike | null;
  netInfo?: NetInfoLike | null;
}

export function createReactNativeClient(
  apiKey: string,
  options?: PulseOptions,
  overrides: ReactNativeClientOverrides = {},
): PulseClient {
  const store = overrides.asyncStorage ?? loadAsyncStorage();
  const client = new PulseClient({
    apiKey,
    options,
    defaults: RN_DEFAULTS,
    sdk: { name: 'pulse-react-native', version: SDK_VERSION },
    transport: overrides.transport ?? fetchTransport(),
    clock: overrides.clock ?? realClock(),
    keyValueStorage: new AsyncKeyValueStorage(store),
    queueStorage: new AsyncQueueStorage(store),
  });

  // Best-effort flush when the app backgrounds (§7 trigger 4).
  const appState = overrides.appState !== undefined ? overrides.appState : loadAppState();
  appState?.addEventListener('change', (state) => {
    if (state === 'background' || state === 'inactive') client.flush();
  });

  // NetInfo is optional (§ platform notes): with it we flush as soon as
  // connectivity returns; without it the retry backoff recovers on its own.
  const netInfo = overrides.netInfo !== undefined ? overrides.netInfo : loadNetInfo();
  netInfo?.addEventListener((state) => {
    if (state.isConnected) client.flush();
  });

  return client;
}

function loadAsyncStorage(): AsyncStorageLike {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-async-storage/async-storage') as {
      default?: AsyncStorageLike;
    } & AsyncStorageLike;
    return mod.default ?? mod;
  } catch {
    console.error(
      'pulse: @react-native-async-storage/async-storage is not installed — events will not survive restarts',
    );
    return new MemoryAsyncStorage();
  }
}

function loadAppState(): AppStateLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('react-native') as { AppState: AppStateLike }).AppState;
  } catch {
    return null;
  }
}

function loadNetInfo(): NetInfoLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-community/netinfo') as { default?: NetInfoLike } & NetInfoLike;
    return mod.default ?? mod;
  } catch {
    return null; // optional dependency
  }
}

function realClock(): PulseClock {
  return {
    nowMs: () => Date.now(),
    schedule(afterMs: number, work: () => void): PulseCancellable {
      const id = setTimeout(work, afterMs);
      return { cancel: () => clearTimeout(id) };
    },
  };
}

function fetchTransport(): PulseTransport {
  return {
    send(request, callback) {
      fetch(request.url, { method: 'POST', headers: request.headers, body: request.body })
        .then(async (res) => callback({ ok: true, status: res.status, body: await res.text() }))
        .catch((error: unknown) => callback({ ok: false, error }));
    },
  };
}

// ------------------------------------------------------------- public API

let shared: PulseClient | null = null;
let warnedNotInitialized = false;

function client(): PulseClient | null {
  if (!shared && !warnedNotInitialized) {
    warnedNotInitialized = true;
    console.warn('pulse: call Pulse.init(apiKey) first');
  }
  return shared;
}

/** Pulse for React Native. Pure JS — no native modules, Expo-compatible. */
export const Pulse = {
  init(apiKey: string, options?: PulseOptions): void {
    if (shared) return;
    shared = createReactNativeClient(apiKey, options);
  },
  track(event: string, properties?: PulseProperties): void {
    client()?.track(event, properties);
  },
  identify(userId: string): void {
    client()?.identify(userId);
  },
  reset(): void {
    client()?.reset();
  },
  flush(): void {
    client()?.flush();
  },
};

export default Pulse;
