import type { PulseKeyValueStorage, PulseQueueStorage } from '@pulse/core';

/** The subset of @react-native-async-storage/async-storage we use. */
export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export class AsyncKeyValueStorage implements PulseKeyValueStorage {
  constructor(
    private store: AsyncStorageLike,
    private prefix = 'pulse:',
  ) {}

  get(key: string): Promise<string | null> {
    return this.store.getItem(this.prefix + key);
  }
  set(key: string, value: string): void {
    void this.store.setItem(this.prefix + key, value).catch(() => {});
  }
  remove(key: string): void {
    void this.store.removeItem(this.prefix + key).catch(() => {});
  }
}

/**
 * Queue blob over AsyncStorage: reads happen once at hydration; writes are
 * serialized through a promise chain so snapshots land in order.
 */
export class AsyncQueueStorage implements PulseQueueStorage {
  private cache: string[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private store: AsyncStorageLike,
    private key = 'pulse:queue',
  ) {}

  async loadAll(): Promise<string[]> {
    try {
      const raw = await this.store.getItem(this.key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      this.cache = Array.isArray(parsed) ? parsed.filter((i): i is string => typeof i === 'string') : [];
    } catch {
      this.cache = [];
    }
    return [...this.cache];
  }

  append(itemJson: string): void {
    this.cache.push(itemJson);
    this.persist();
  }

  markConsumed(count: number): void {
    this.cache.splice(0, count);
    this.persist();
  }

  replaceAll(items: string[]): void {
    this.cache = [...items];
    this.persist();
  }

  private persist(): void {
    const snapshot = JSON.stringify(this.cache);
    this.chain = this.chain.then(() => this.store.setItem(this.key, snapshot)).catch(() => {});
  }
}

/** In-memory stand-in when AsyncStorage is not installed (no persistence). */
export class MemoryAsyncStorage implements AsyncStorageLike {
  private map = new Map<string, string>();

  getItem(key: string): Promise<string | null> {
    return Promise.resolve(this.map.get(key) ?? null);
  }
  setItem(key: string, value: string): Promise<void> {
    this.map.set(key, value);
    return Promise.resolve();
  }
  removeItem(key: string): Promise<void> {
    this.map.delete(key);
    return Promise.resolve();
  }
}
