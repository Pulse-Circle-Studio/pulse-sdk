import type { PulseKeyValueStorage } from '@pulse/core';

const UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term'] as const;
const K_PENDING = 'pulse_utm_pending';
const SESSION_FLAG = 'pulse:utm_captured';

export interface SessionFlagStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/**
 * Protocol §9: capture utm_* from the URL once per session; park the result
 * in persistent storage until the next batch picks it up.
 */
export function captureUtmOnce(
  search: string,
  session: SessionFlagStore,
  persistent: PulseKeyValueStorage,
): void {
  try {
    if (session.get(SESSION_FLAG)) return;
    session.set(SESSION_FLAG, '1');
  } catch {
    return; // no sessionStorage — do not risk re-capturing on every load
  }
  const params = new URLSearchParams(search);
  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = params.get(`utm_${key}`);
    if (value) utm[key] = value;
  }
  if (Object.keys(utm).length > 0) {
    void persistent.set(K_PENDING, JSON.stringify(utm));
  }
}

/** One-shot supplier of `{ utm }` context extras for PulseClient. */
export function utmContextExtras(
  persistent: PulseKeyValueStorage,
): () => Record<string, unknown> | null {
  return () => {
    const raw = persistent.get(K_PENDING);
    if (typeof raw !== 'string' || !raw) return null;
    void persistent.remove(K_PENDING);
    try {
      return { utm: JSON.parse(raw) as Record<string, string> };
    } catch {
      return null;
    }
  };
}
