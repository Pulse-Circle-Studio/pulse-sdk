/** Epoch-milliseconds clock plus timer scheduling; virtualized in tests. */
export interface PulseClock {
  nowMs(): number;
  schedule(afterMs: number, work: () => void): PulseCancellable;
}

export interface PulseCancellable {
  cancel(): void;
}

export interface PulseHttpRequest {
  /** Absolute URL: endpoint + path. */
  url: string;
  /** Request path, e.g. "/v1/batch" (kept separate for test transports). */
  path: string;
  headers: Record<string, string>;
  /** Pre-serialized JSON body. Retries resend this exact string. */
  body: string;
}

export type PulseHttpResult =
  | { ok: true; status: number; body: string }
  | { ok: false; error: unknown };

export interface PulseTransport {
  send(request: PulseHttpRequest, callback: (result: PulseHttpResult) => void): void;
}

/**
 * Small-value persistence (identity, identify-dedup). Implementations may be
 * synchronous (localStorage, in-memory) or asynchronous (AsyncStorage); the
 * client only awaits reads during init hydration. Writes are fire-and-forget.
 */
export interface PulseKeyValueStorage {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove(key: string): void | Promise<void>;
}

/**
 * Persistence for the event queue. Items are opaque pre-serialized JSON
 * strings, ordered head-first. `markConsumed` removes from the head;
 * `replaceAll` is used for eviction/reordering (poison-batch tail moves).
 */
export interface PulseQueueStorage {
  loadAll(): string[] | Promise<string[]>;
  append(itemJson: string): void | Promise<void>;
  markConsumed(count: number): void | Promise<void>;
  replaceAll(items: string[]): void | Promise<void>;
}

export interface PulseLogger {
  debug(message: string): void;
  error(message: string): void;
}

export interface PulseOptions {
  /** Ingestion endpoint override. */
  endpoint?: string;
  /** Queue size that triggers an automatic flush. Default 20. */
  flushAt?: number;
  /** Flush timer armed by the first unflushed event. Default: 10 s web, 30 s mobile. */
  flushIntervalMs?: number;
  /** Queue cap with FIFO eviction. Default: 1,000 web, 5,000 mobile. */
  maxQueueEvents?: number;
  /** Log queue activity, rejected events, and evictions. */
  debug?: boolean;
}

export interface PulseClientConfig {
  apiKey: string;
  options?: PulseOptions;
  /** Platform defaults; options override these. */
  defaults: Required<Omit<PulseOptions, 'debug'>> & { debug: boolean };
  sdk: { name: string; version: string };
  transport: PulseTransport;
  clock: PulseClock;
  keyValueStorage: PulseKeyValueStorage;
  queueStorage: PulseQueueStorage;
  logger?: PulseLogger;
  /** Uniform [0, 1) source for retry jitter. */
  random?: () => number;
  /**
   * One-shot extra context for the next /v1/batch (web UTM capture). Called
   * when a batch body is assembled; a non-null return is attached to that
   * batch and, because bodies are pinned, survives its retries.
   */
  takeContextExtras?: () => Record<string, unknown> | null;
}

export type PulseProperties = Record<string, unknown>;
