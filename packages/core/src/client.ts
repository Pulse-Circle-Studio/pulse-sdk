import type {
  PulseCancellable,
  PulseClientConfig,
  PulseHttpResult,
  PulseLogger,
  PulseProperties,
} from './types.js';
import { sanitizeProperties } from './sanitize.js';
import { ulid, uuid4 } from './ulid.js';

const K_ANON = 'pulse_anonymous_id';
const K_USER = 'pulse_user_id';
const K_PAIRS = 'pulse_identified_pairs';

const MAX_BATCH_EVENTS = 100;
const MAX_BODY_BYTES = 512 * 1024;
/** Reserved for the {"batch":[...],"context":{...}} wrapper. */
const BODY_OVERHEAD_BYTES = 2 * 1024;
const MAX_ATTEMPTS = 10;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 300_000;
const MAX_REMEMBERED_PAIRS = 200;

type QueueNode =
  | { kind: 'track' | 'identify'; json: string; bytes: number }
  /** A poison batch moved to the tail: resent as-is, never merged (§8). */
  | { kind: 'unit'; path: string; body: string; jsons: string[] };

interface OutgoingBatch {
  path: string;
  body: string;
  nodeCount: number;
  itemCount: number;
  attempts: number;
}

const noopLogger: PulseLogger = { debug() {}, error() {} };

export class PulseClient {
  private readonly cfg: PulseClientConfig;
  private readonly endpoint: string;
  private readonly flushAt: number;
  private readonly flushIntervalMs: number;
  private readonly maxQueueEvents: number;
  private readonly debug: boolean;
  private readonly logger: PulseLogger;
  private readonly random: () => number;

  private queue: QueueNode[] = [];
  private queuedItemCount = 0;
  private pinned: OutgoingBatch | null = null;
  private inFlight = false;
  private retryTimer: PulseCancellable | null = null;
  private flushTimer: PulseCancellable | null = null;

  private anonymousId = '';
  private userId: string | undefined;
  private identifiedPairs: Array<[string, string]> = [];
  private authErrorLogged = false;

  private hydrated = false;
  private pendingOps: Array<() => void> = [];
  private disposed = false;

  constructor(config: PulseClientConfig) {
    this.cfg = config;
    const o = config.options ?? {};
    const d = config.defaults;
    this.endpoint = (o.endpoint ?? d.endpoint).replace(/\/$/, '');
    this.flushAt = o.flushAt ?? d.flushAt;
    this.flushIntervalMs = o.flushIntervalMs ?? d.flushIntervalMs;
    this.maxQueueEvents = o.maxQueueEvents ?? d.maxQueueEvents;
    this.debug = o.debug ?? d.debug;
    this.logger = config.logger ?? (this.debug ? consoleLogger() : noopLogger);
    this.random = config.random ?? Math.random;
    this.hydrate();
  }

  // ---------------------------------------------------------------- public

  track(event: string, properties?: PulseProperties): void {
    if (!event || typeof event !== 'string') {
      this.logDebug('track() called without an event name — dropped');
      return;
    }
    // Key and timestamp are captured at call time (§3), even if hydration is
    // still in progress and the enqueue itself is deferred.
    const nowMs = this.cfg.clock.nowMs();
    const key = `evt_${ulid(nowMs)}`;
    const timestamp = new Date(nowMs).toISOString();
    this.run(() => this.doTrack(event, properties, key, timestamp));
  }

  identify(userId: string): void {
    if (!userId || typeof userId !== 'string') {
      this.logDebug('identify() called without a user id — ignored');
      return;
    }
    const key = `idf_${ulid(this.cfg.clock.nowMs())}`;
    this.run(() => this.doIdentify(userId, key));
  }

  reset(): void {
    this.run(() => {
      this.anonymousId = uuid4();
      void this.cfg.keyValueStorage.set(K_ANON, this.anonymousId);
      this.userId = undefined;
      void this.cfg.keyValueStorage.remove(K_USER);
      this.logDebug('reset(): new anonymous_id issued');
    });
  }

  flush(): void {
    this.run(() => this.maybeSend());
  }

  /** Cancels timers. Queued events stay persisted for the next instance. */
  dispose(): void {
    this.disposed = true;
    this.flushTimer?.cancel();
    this.flushTimer = null;
    this.retryTimer?.cancel();
    this.retryTimer = null;
  }

  // ------------------------------------------------------------- hydration

  private hydrate(): void {
    const kv = this.cfg.keyValueStorage;
    Promise.all([kv.get(K_ANON), kv.get(K_USER), kv.get(K_PAIRS), this.cfg.queueStorage.loadAll()])
      .then(([anon, user, pairs, items]) => this.finishHydration(anon, user, pairs, items))
      .catch((err) => {
        this.logger.error(`pulse: storage unavailable, starting with a fresh state (${String(err)})`);
        this.finishHydration(null, null, null, []);
      });
  }

  private finishHydration(
    anon: string | null,
    user: string | null,
    pairs: string | null,
    items: string[],
  ): void {
    if (this.disposed) return;
    if (anon) {
      this.anonymousId = anon;
    } else {
      this.anonymousId = uuid4();
      void this.cfg.keyValueStorage.set(K_ANON, this.anonymousId);
    }
    this.userId = user ?? undefined;
    this.identifiedPairs = parsePairs(pairs);

    for (const json of items) {
      const kind = classify(json);
      if (!kind) {
        this.logDebug('pulse: skipped corrupted persisted queue item');
        continue;
      }
      this.queue.push({ kind, json, bytes: utf8Length(json) });
      this.queuedItemCount++;
    }

    this.hydrated = true;
    const ops = this.pendingOps;
    this.pendingOps = [];
    for (const op of ops) op();
    // Events restored from a previous process are unflushed events: arm the
    // interval timer so they are delivered even if the app stays quiet.
    if (this.queuedItemCount > 0) this.armFlushTimer();
  }

  private run(op: () => void): void {
    if (this.disposed) return;
    if (this.hydrated) op();
    else this.pendingOps.push(op);
  }

  // --------------------------------------------------------------- enqueue

  private doTrack(
    event: string,
    properties: PulseProperties | undefined,
    key: string,
    timestamp: string,
  ): void {
    const wire: Record<string, unknown> = { type: 'track', anonymous_id: this.anonymousId };
    if (this.userId !== undefined) wire.user_id = this.userId;
    wire.event = event;
    wire.properties = sanitizeProperties(properties, this.logger, this.debug);
    wire.idempotency_key = key;
    wire.timestamp = timestamp;
    this.enqueue('track', JSON.stringify(wire));
  }

  private doIdentify(userId: string, key: string): void {
    const anon = this.anonymousId;
    this.userId = userId;
    void this.cfg.keyValueStorage.set(K_USER, userId);

    if (this.identifiedPairs.some(([a, u]) => a === anon && u === userId)) {
      this.logDebug(`pulse: identify(${userId}) already sent for this anonymous_id — deduplicated`);
      return;
    }
    this.identifiedPairs.push([anon, userId]);
    if (this.identifiedPairs.length > MAX_REMEMBERED_PAIRS) this.identifiedPairs.shift();
    void this.cfg.keyValueStorage.set(K_PAIRS, JSON.stringify(this.identifiedPairs));

    const wire = { anonymous_id: anon, user_id: userId, idempotency_key: key };
    this.enqueue('identify', JSON.stringify(wire));
  }

  private enqueue(kind: 'track' | 'identify', json: string): void {
    this.queue.push({ kind, json, bytes: utf8Length(json) });
    this.queuedItemCount++;
    void this.cfg.queueStorage.append(json);
    this.evictIfNeeded();
    if (this.queuedItemCount >= this.flushAt) this.maybeSend();
    else this.armFlushTimer();
  }

  /** FIFO eviction at the cap, skipping in-flight (pinned) nodes (§6). */
  private evictIfNeeded(): void {
    if (this.queuedItemCount <= this.maxQueueEvents) return;
    const protectedNodes = this.pinned ? this.pinned.nodeCount : 0;
    let evicted = 0;
    const index = protectedNodes;
    while (this.queuedItemCount > this.maxQueueEvents && index < this.queue.length) {
      const node = this.queue[index]!;
      const size = node.kind === 'unit' ? node.jsons.length : 1;
      this.queue.splice(index, 1);
      this.queuedItemCount -= size;
      evicted += size;
    }
    if (evicted > 0) {
      void this.cfg.queueStorage.replaceAll(this.flattened());
      this.logDebug(`pulse: queue cap ${this.maxQueueEvents} reached — evicted ${evicted} oldest event(s)`);
    }
  }

  // ---------------------------------------------------------------- sending

  /** Flush trigger. No-op while a request is in flight or a backoff is pending (§7). */
  private maybeSend(): void {
    if (!this.hydrated || this.inFlight || this.retryTimer) return;
    this.sendNext();
  }

  private sendNext(): void {
    if (this.disposed) return;
    const batch = this.pinned ?? this.buildNext();
    if (!batch) {
      this.clearFlushTimer();
      return;
    }
    this.pinned = batch;
    this.inFlight = true;
    this.cfg.transport.send(
      {
        url: this.endpoint + batch.path,
        path: batch.path,
        headers: {
          authorization: `Bearer ${this.cfg.apiKey}`,
          'content-type': 'application/json',
          'x-pulse-protocol': '1',
        },
        body: batch.body,
      },
      (result) => this.onResult(result),
    );
  }

  private buildNext(): OutgoingBatch | null {
    const head = this.queue[0];
    if (!head) return null;
    if (head.kind === 'unit') {
      return { path: head.path, body: head.body, nodeCount: 1, itemCount: head.jsons.length, attempts: 0 };
    }
    if (head.kind === 'identify') {
      return { path: '/v1/identify', body: head.json, nodeCount: 1, itemCount: 1, attempts: 0 };
    }
    const jsons: string[] = [];
    let bytes = 0;
    for (const node of this.queue) {
      if (node.kind !== 'track') break;
      if (jsons.length >= MAX_BATCH_EVENTS) break;
      if (jsons.length > 0 && bytes + node.bytes + 1 > MAX_BODY_BYTES - BODY_OVERHEAD_BYTES) break;
      jsons.push(node.json);
      bytes += node.bytes + 1;
    }
    const body = `{"batch":[${jsons.join(',')}],"context":${JSON.stringify(this.buildContext())}}`;
    return { path: '/v1/batch', body, nodeCount: jsons.length, itemCount: jsons.length, attempts: 0 };
  }

  private buildContext(): Record<string, unknown> {
    const context: Record<string, unknown> = {
      sdk: { name: this.cfg.sdk.name, version: this.cfg.sdk.version },
    };
    const extras = this.cfg.takeContextExtras?.();
    if (extras) Object.assign(context, extras);
    return context;
  }

  private onResult(result: PulseHttpResult): void {
    if (this.disposed) return;
    this.inFlight = false;
    const batch = this.pinned;
    if (!batch) return;

    if (result.ok && result.status >= 200 && result.status < 300) {
      this.logRejected(result.body);
      this.consumeHead(batch);
      this.continueDrain();
      return;
    }

    const retryable = !result.ok || result.status === 408 || result.status === 429 || result.status >= 500;
    if (!retryable) {
      // Deterministic rejection: drop the batch (§3).
      if (result.ok && result.status === 401) {
        if (!this.authErrorLogged) {
          this.authErrorLogged = true;
          this.logger.error('pulse: API key rejected (401) — events are being dropped');
        }
      } else {
        this.logger.error(`pulse: batch dropped (HTTP ${result.ok ? result.status : '?'})`);
      }
      this.consumeHead(batch);
      this.continueDrain();
      return;
    }

    batch.attempts++;
    if (batch.attempts >= MAX_ATTEMPTS) {
      this.moveToTail(batch);
      this.sendNext();
      return;
    }
    const base = Math.min(BACKOFF_BASE_MS * 2 ** (batch.attempts - 1), BACKOFF_CAP_MS);
    const delay = Math.round(base * (1 + (this.random() * 0.4 - 0.2)));
    this.logDebug(`pulse: delivery failed (attempt ${batch.attempts}), retrying in ${delay} ms`);
    this.retryTimer = this.cfg.clock.schedule(delay, () => {
      this.retryTimer = null;
      this.sendNext();
    });
  }

  private consumeHead(batch: OutgoingBatch): void {
    this.queue.splice(0, batch.nodeCount);
    this.queuedItemCount -= batch.itemCount;
    void this.cfg.queueStorage.markConsumed(batch.itemCount);
    this.pinned = null;
  }

  private continueDrain(): void {
    if (this.queue.length > 0) this.sendNext();
    else this.clearFlushTimer();
  }

  /** Poison-batch protection: after MAX_ATTEMPTS the batch moves to the tail
   *  as a pinned unit and the next batch goes out immediately (§8). */
  private moveToTail(batch: OutgoingBatch): void {
    const removed = this.queue.splice(0, batch.nodeCount);
    const jsons = removed.flatMap((n) => (n.kind === 'unit' ? n.jsons : [n.json]));
    this.queue.push({ kind: 'unit', path: batch.path, body: batch.body, jsons });
    void this.cfg.queueStorage.replaceAll(this.flattened());
    this.pinned = null;
    this.logger.error(
      `pulse: batch failed ${MAX_ATTEMPTS} times — moved to the back of the queue (${jsons.length} event(s))`,
    );
  }

  private flattened(): string[] {
    return this.queue.flatMap((n) => (n.kind === 'unit' ? n.jsons : [n.json]));
  }

  private logRejected(body: string): void {
    if (!this.debug) return;
    try {
      const parsed = JSON.parse(body) as { rejected?: Array<{ key: string; reason: string }> };
      for (const r of parsed.rejected ?? []) {
        this.logger.debug(`pulse: server rejected ${r.key}: ${r.reason} (will not retry)`);
      }
    } catch {
      /* response body is informational only */
    }
  }

  // ----------------------------------------------------------------- timers

  private armFlushTimer(): void {
    if (this.flushTimer || this.inFlight || this.retryTimer) return;
    this.flushTimer = this.cfg.clock.schedule(this.flushIntervalMs, () => {
      this.flushTimer = null;
      this.maybeSend();
    });
  }

  private clearFlushTimer(): void {
    this.flushTimer?.cancel();
    this.flushTimer = null;
  }

  private logDebug(message: string): void {
    if (this.debug) this.logger.debug(message);
  }
}

// ------------------------------------------------------------------ helpers

function classify(json: string): 'track' | 'identify' | null {
  try {
    const parsed = JSON.parse(json) as { type?: string; idempotency_key?: string };
    if (parsed && typeof parsed === 'object') {
      return parsed.type === 'track' ? 'track' : 'identify';
    }
  } catch {
    /* corrupted */
  }
  return null;
}

function parsePairs(raw: string | null): Array<[string, string]> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (p): p is [string, string] =>
          Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && typeof p[1] === 'string',
      );
    }
  } catch {
    /* corrupted */
  }
  return [];
}

function utf8Length(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4; // surrogate pair
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function consoleLogger(): PulseLogger {
  return {
    debug: (m) => console.debug(m),
    error: (m) => console.error(m),
  };
}
