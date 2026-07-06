/**
 * Test doubles + the conformance fixture runner (protocol/FIXTURES.md).
 * Import from '@pulse/core/testing'. Not part of the runtime bundle.
 */
import type {
  PulseCancellable,
  PulseClock,
  PulseHttpRequest,
  PulseHttpResult,
  PulseKeyValueStorage,
  PulseProperties,
  PulseQueueStorage,
  PulseTransport,
} from './types.js';

// ------------------------------------------------------------ test doubles

export interface PendingRequest {
  request: PulseHttpRequest;
  callback: (result: PulseHttpResult) => void;
}

export class MockTransport implements PulseTransport {
  readonly pending: PendingRequest[] = [];

  send(request: PulseHttpRequest, callback: (result: PulseHttpResult) => void): void {
    this.pending.push({ request, callback });
  }

  shift(): PendingRequest | undefined {
    return this.pending.shift();
  }
}

interface VirtualTimer {
  at: number;
  seq: number;
  work: () => void;
  cancelled: boolean;
}

export class VirtualClock implements PulseClock {
  private currentMs = Date.parse('2026-01-01T00:00:00.000Z');
  private seq = 0;
  private timers: VirtualTimer[] = [];

  nowMs(): number {
    return this.currentMs;
  }

  schedule(afterMs: number, work: () => void): PulseCancellable {
    const timer: VirtualTimer = { at: this.currentMs + afterMs, seq: this.seq++, work, cancelled: false };
    this.timers.push(timer);
    return {
      cancel: () => {
        timer.cancelled = true;
      },
    };
  }

  /** Advance virtual time, firing due timers chronologically, settling after each. */
  async advance(ms: number): Promise<void> {
    const target = this.currentMs + ms;
    for (;;) {
      const due = this.timers
        .filter((t) => !t.cancelled && t.at <= target)
        .sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.currentMs = Math.max(this.currentMs, due.at);
      due.work();
      await settle();
    }
    this.currentMs = target;
  }
}

export class InMemoryKeyValueStorage implements PulseKeyValueStorage {
  private map = new Map<string, string>();

  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  remove(key: string): void {
    this.map.delete(key);
  }
}

export class InMemoryQueueStorage implements PulseQueueStorage {
  items: string[] = [];

  loadAll(): string[] {
    return [...this.items];
  }
  append(itemJson: string): void {
    this.items.push(itemJson);
  }
  markConsumed(count: number): void {
    this.items.splice(0, count);
  }
  replaceAll(items: string[]): void {
    this.items = [...items];
  }
}

/** Two macrotask ticks: lets hydration promises and transport callbacks land. */
export async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

// ------------------------------------------------------------------ runner

export interface Fixture {
  name: string;
  description?: string;
  platforms?: string[];
  steps: Array<Record<string, unknown>>;
}

export interface FixtureEnv {
  clock: VirtualClock;
  transport: MockTransport;
  kv: InMemoryKeyValueStorage;
  queue: InMemoryQueueStorage;
}

export interface FixtureInit {
  apiKey: string;
  options: Record<string, unknown>;
  pageUrl?: string;
}

export interface FixtureClient {
  track(event: string, properties?: PulseProperties): void;
  identify(userId: string): void;
  reset(): void;
  flush(): void;
  dispose(): void;
}

export type FixtureClientFactory = (init: FixtureInit, env: FixtureEnv) => FixtureClient;

class FixtureError extends Error {
  constructor(fixture: string, stepIndex: number, message: string) {
    super(`[${fixture}] step ${stepIndex}: ${message}`);
  }
}

export async function runFixture(fixture: Fixture, createClient: FixtureClientFactory): Promise<void> {
  const env: FixtureEnv = {
    clock: new VirtualClock(),
    transport: new MockTransport(),
    kv: new InMemoryKeyValueStorage(),
    queue: new InMemoryQueueStorage(),
  };
  const captures = new Map<string, unknown>();
  let client: FixtureClient | null = null;
  let initArgs: FixtureInit | null = null;

  const fail = (i: number, msg: string): never => {
    throw new FixtureError(fixture.name, i, msg);
  };

  for (let i = 0; i < fixture.steps.length; i++) {
    const step = fixture.steps[i]!;
    switch (step.do) {
      case 'init': {
        initArgs = {
          apiKey: step.apiKey as string,
          options: (step.options as Record<string, unknown>) ?? {},
          pageUrl: step.pageUrl as string | undefined,
        };
        client = createClient(initArgs, env);
        break;
      }
      case 'track':
        client!.track(step.event as string, step.properties as PulseProperties | undefined);
        break;
      case 'trackMany': {
        const count = step.count as number;
        const indexProperty = step.indexProperty as string;
        for (let n = 0; n < count; n++) {
          client!.track(step.event as string, { [indexProperty]: n });
        }
        break;
      }
      case 'identify':
        client!.identify(step.userId as string);
        break;
      case 'reset':
        client!.reset();
        break;
      case 'flush':
        client!.flush();
        break;
      case 'advance':
        await env.clock.advance(step.ms as number);
        break;
      case 'restart':
        client!.dispose();
        client = createClient(initArgs!, env);
        break;
      case 'expectRequest': {
        await settle();
        const pending = env.transport.shift();
        if (!pending) return fail(i, 'expected a pending request, found none');
        const expected = step.request as Record<string, unknown>;
        try {
          matchRequest(expected, pending.request, captures);
        } catch (err) {
          return fail(i, (err as Error).message);
        }
        const respond = step.respond as Record<string, unknown>;
        if (respond.networkError) {
          pending.callback({ ok: false, error: new Error('fixture: network error') });
        } else {
          const requestBody = JSON.parse(pending.request.body) as Record<string, unknown>;
          const body = renderResponse(respond.body, requestBody);
          pending.callback({ ok: true, status: respond.status as number, body: JSON.stringify(body) });
        }
        break;
      }
      case 'expectNoRequest': {
        await settle();
        if (env.transport.pending.length > 0) {
          return fail(
            i,
            `expected no pending request, found ${env.transport.pending.length} (first: ${env.transport.pending[0]!.request.path})`,
          );
        }
        break;
      }
      default:
        return fail(i, `unknown step "${String(step.do)}"`);
    }
    await settle();
  }

  if (env.transport.pending.length > 0) {
    throw new FixtureError(
      fixture.name,
      fixture.steps.length,
      `fixture ended with ${env.transport.pending.length} unconsumed pending request(s)`,
    );
  }
}

// ---------------------------------------------------------------- matching

const RE = {
  uuid4: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  eventKey: /^evt_[0-9A-HJKMNP-TV-Z]{26}$/,
  identifyKey: /^idf_[0-9A-HJKMNP-TV-Z]{26}$/,
  isoTimestamp: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  string: /^.+$/,
} as const;

type MatcherKind = keyof typeof RE;

function matchRequest(
  expected: Record<string, unknown>,
  actual: PulseHttpRequest,
  captures: Map<string, unknown>,
): void {
  if (expected.path !== actual.path) {
    throw new Error(`path mismatch: expected ${String(expected.path)}, got ${actual.path}`);
  }
  const headers = expected.headers as Record<string, string> | undefined;
  if (headers) {
    const actualHeaders = Object.fromEntries(
      Object.entries(actual.headers).map(([k, v]) => [k.toLowerCase(), v]),
    );
    for (const [name, value] of Object.entries(headers)) {
      const got = actualHeaders[name.toLowerCase()];
      if (got !== value) {
        throw new Error(`header ${name}: expected "${value}", got ${got === undefined ? 'nothing' : `"${got}"`}`);
      }
    }
  }
  if (expected.body !== undefined) {
    const actualBody = JSON.parse(actual.body) as unknown;
    matchValue(expected.body, actualBody, captures, 'body');
  }
}

export function matchValue(
  expected: unknown,
  actual: unknown,
  captures: Map<string, unknown>,
  path: string,
): void {
  if (typeof expected === 'string' && expected.startsWith('$')) {
    matchMatcher(expected, actual, captures, path);
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) throw new Error(`${path}: expected an array, got ${describe(actual)}`);
    if (actual.length !== expected.length) {
      throw new Error(`${path}: expected ${expected.length} element(s), got ${actual.length}`);
    }
    expected.forEach((item, i) => matchValue(item, actual[i], captures, `${path}[${i}]`));
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    const keys = Object.keys(expected as Record<string, unknown>);
    if (keys.length === 1 && keys[0] === '$seq') {
      matchSeq((expected as Record<string, unknown>).$seq as SeqSpec, actual, path);
      return;
    }
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
      throw new Error(`${path}: expected an object, got ${describe(actual)}`);
    }
    const actualObj = actual as Record<string, unknown>;
    const actualKeys = Object.keys(actualObj).sort();
    const expectedKeys = [...keys].sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
      throw new Error(
        `${path}: key mismatch — expected {${expectedKeys.join(', ')}}, got {${actualKeys.join(', ')}}`,
      );
    }
    for (const key of keys) {
      matchValue((expected as Record<string, unknown>)[key], actualObj[key], captures, `${path}.${key}`);
    }
    return;
  }
  if (expected !== actual) {
    throw new Error(`${path}: expected ${describe(expected)}, got ${describe(actual)}`);
  }
}

function matchMatcher(
  matcher: string,
  actual: unknown,
  captures: Map<string, unknown>,
  path: string,
): void {
  const asString = (): string => {
    if (typeof actual !== 'string') throw new Error(`${path}: expected a string for ${matcher}, got ${describe(actual)}`);
    return actual;
  };
  if (matcher.startsWith('$capture:')) {
    const [, name, kind] = matcher.split(':');
    matchKind(kind as MatcherKind, asString(), path, matcher);
    captures.set(name!, actual);
    return;
  }
  if (matcher.startsWith('$same:')) {
    const name = matcher.slice('$same:'.length);
    if (!captures.has(name)) throw new Error(`${path}: $same references unknown capture "${name}"`);
    if (captures.get(name) !== actual) {
      throw new Error(`${path}: expected captured "${name}" (${describe(captures.get(name))}), got ${describe(actual)}`);
    }
    return;
  }
  if (matcher.startsWith('$differs:')) {
    const [, name, kind] = matcher.split(':');
    matchKind(kind as MatcherKind, asString(), path, matcher);
    if (!captures.has(name!)) throw new Error(`${path}: $differs references unknown capture "${name}"`);
    if (captures.get(name!) === actual) {
      throw new Error(`${path}: expected a value different from captured "${name}", got the same (${describe(actual)})`);
    }
    return;
  }
  const kind = matcher.slice(1) as MatcherKind;
  matchKind(kind, asString(), path, matcher);
}

function matchKind(kind: MatcherKind, value: string, path: string, matcher: string): void {
  const re = RE[kind];
  if (!re) throw new Error(`${path}: unknown matcher "${matcher}"`);
  if (!re.test(value)) throw new Error(`${path}: "${value}" does not match ${matcher}`);
}

interface SeqSpec {
  event: string;
  indexProperty: string;
  start: number;
  count: number;
}

function matchSeq(spec: SeqSpec, actual: unknown, path: string): void {
  if (!Array.isArray(actual)) throw new Error(`${path}: expected a batch array, got ${describe(actual)}`);
  if (actual.length !== spec.count) {
    throw new Error(`${path}: expected ${spec.count} events, got ${actual.length}`);
  }
  const noCaptures = new Map<string, unknown>();
  actual.forEach((item, i) => {
    matchValue(
      {
        type: 'track',
        anonymous_id: '$uuid4',
        event: spec.event,
        properties: { [spec.indexProperty]: spec.start + i },
        idempotency_key: '$eventKey',
        timestamp: '$isoTimestamp',
      },
      item,
      noCaptures,
      `${path}[${i}]`,
    );
  });
}

function describe(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (value === undefined) return 'undefined';
  return JSON.stringify(value) ?? String(value);
}

// ------------------------------------------------------ response templates

function renderResponse(template: unknown, requestBody: Record<string, unknown>): unknown {
  const batch = (requestBody.batch as Array<Record<string, unknown>> | undefined) ?? [];
  const render = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (value === '$allKeys') return batch.map((item) => item.idempotency_key);
      if (value.startsWith('$key:')) {
        const index = Number(value.slice('$key:'.length));
        return batch[index]?.idempotency_key;
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(render);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, render(v)]));
    }
    return value;
  };
  return render(template);
}
