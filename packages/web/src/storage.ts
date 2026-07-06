import type { PulseKeyValueStorage, PulseQueueStorage } from '@pulse/core';

/** localStorage-backed KV with graceful fallback (private mode, quota). */
export class BrowserKeyValueStorage implements PulseKeyValueStorage {
  private fallback = new Map<string, string>();

  constructor(private prefix = 'pulse:') {}

  get(key: string): string | null {
    try {
      return window.localStorage.getItem(this.prefix + key);
    } catch {
      return this.fallback.get(key) ?? null;
    }
  }

  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(this.prefix + key, value);
    } catch {
      this.fallback.set(key, value);
    }
  }

  remove(key: string): void {
    try {
      window.localStorage.removeItem(this.prefix + key);
    } catch {
      this.fallback.delete(key);
    }
  }
}

/** The queue as a single localStorage blob, mirrored in memory. */
export class BrowserQueueStorage implements PulseQueueStorage {
  private cache: string[] | null = null;

  constructor(private key = 'pulse:queue') {}

  loadAll(): string[] {
    return [...this.load()];
  }

  append(itemJson: string): void {
    this.load().push(itemJson);
    this.persist();
  }

  markConsumed(count: number): void {
    this.load().splice(0, count);
    this.persist();
  }

  replaceAll(items: string[]): void {
    this.cache = [...items];
    this.persist();
  }

  private load(): string[] {
    if (this.cache) return this.cache;
    try {
      const raw = window.localStorage.getItem(this.key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      this.cache = Array.isArray(parsed) ? parsed.filter((i): i is string => typeof i === 'string') : [];
    } catch {
      this.cache = [];
    }
    return this.cache;
  }

  private persist(): void {
    try {
      window.localStorage.setItem(this.key, JSON.stringify(this.cache));
    } catch {
      /* quota exceeded / private mode: the in-memory queue keeps working */
    }
  }
}
