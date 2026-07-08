import {
  DEFAULT_ENDPOINT,
  PulseClient,
  SDK_VERSION,
  type PulseCancellable,
  type PulseClock,
  type PulseKeyValueStorage,
  type PulseOptions,
  type PulseProperties,
  type PulseQueueStorage,
  type PulseTransport,
} from '@pulse-circle/core';
import { BrowserKeyValueStorage, BrowserQueueStorage } from './storage.js';
import { captureUtmOnce, utmContextExtras, type SessionFlagStore } from './utm.js';

export type { PulseOptions, PulseProperties };

const WEB_DEFAULTS = {
  endpoint: DEFAULT_ENDPOINT,
  flushAt: 20,
  flushIntervalMs: 10_000,
  maxQueueEvents: 1_000,
  debug: false,
};

/** Injection points for tests (fixture runner); production uses real ones. */
export interface WebClientOverrides {
  transport?: PulseTransport;
  clock?: PulseClock;
  keyValueStorage?: PulseKeyValueStorage;
  queueStorage?: PulseQueueStorage;
  sessionFlags?: SessionFlagStore;
  /** Overrides window.location for UTM capture. */
  pageUrl?: string;
  /** Skip visibilitychange/pagehide listeners. */
  skipPageListeners?: boolean;
}

export function createWebClient(
  apiKey: string,
  options?: PulseOptions,
  overrides: WebClientOverrides = {},
): PulseClient {
  const kv = overrides.keyValueStorage ?? new BrowserKeyValueStorage();
  const queue = overrides.queueStorage ?? new BrowserQueueStorage();
  const session = overrides.sessionFlags ?? browserSessionFlags();
  const search = pageSearch(overrides.pageUrl);
  captureUtmOnce(search, session, kv);

  const client = new PulseClient({
    apiKey,
    options,
    defaults: WEB_DEFAULTS,
    sdk: { name: 'pulse-web', version: SDK_VERSION },
    transport: overrides.transport ?? fetchTransport(),
    clock: overrides.clock ?? realClock(),
    keyValueStorage: kv,
    queueStorage: queue,
    takeContextExtras: utmContextExtras(kv),
  });

  if (!overrides.skipPageListeners && typeof document !== 'undefined') {
    // Best-effort flush when the page goes away (§10). Events stay queued
    // until a 2xx lands, so a killed request is retried on the next load and
    // deduplicated server-side.
    const onHide = () => {
      if (document.visibilityState === 'hidden') client.flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', () => client.flush());
  }
  return client;
}

function pageSearch(pageUrl?: string): string {
  if (pageUrl) {
    const q = pageUrl.indexOf('?');
    return q === -1 ? '' : pageUrl.slice(q);
  }
  if (typeof window !== 'undefined' && window.location) return window.location.search;
  return '';
}

function browserSessionFlags(): SessionFlagStore {
  return {
    get: (k) => window.sessionStorage.getItem(k),
    set: (k, v) => window.sessionStorage.setItem(k, v),
  };
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
      // keepalive lets the request outlive a dying page; bodies stay well
      // under its 64 KB limit for typical hidden-flush batches.
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        keepalive: hidden && request.body.length < 60_000,
      })
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
    if (typeof console !== 'undefined') console.warn('pulse: call Pulse.init(apiKey) first');
  }
  return shared;
}

/**
 * Pulse for the browser. All methods are SSR-safe no-ops when `window` is
 * not available.
 */
export const Pulse = {
  init(apiKey: string, options?: PulseOptions): void {
    if (typeof window === 'undefined') return; // SSR no-op
    if (shared) return;
    shared = createWebClient(apiKey, options);
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
