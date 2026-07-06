import type { PulseLogger, PulseProperties } from './types.js';

/**
 * Protocol §3: property values are JSON primitives, or objects/arrays nested
 * at most 2 container levels deep. Offending keys are dropped with a debug
 * warning — never reject the whole event.
 */
export function sanitizeProperties(
  properties: PulseProperties | undefined,
  logger: PulseLogger,
  debug: boolean,
): Record<string, unknown> {
  if (properties == null) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    const cleaned = sanitizeValue(value, 1);
    if (cleaned === INVALID) {
      if (debug) logger.debug(`pulse: dropped property "${key}" (unsupported type or nesting deeper than 2 levels)`);
      continue;
    }
    out[key] = cleaned;
  }
  return out;
}

const INVALID = Symbol('invalid');

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'number') return Number.isFinite(value as number) ? value : INVALID;
  if (Array.isArray(value)) {
    if (depth > 2) return INVALID;
    const arr: unknown[] = [];
    for (const item of value) {
      const cleaned = sanitizeValue(item, depth + 1);
      if (cleaned === INVALID) return INVALID;
      arr.push(cleaned);
    }
    return arr;
  }
  if (t === 'object') {
    if (depth > 2) return INVALID;
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = sanitizeValue(v, depth + 1);
      if (cleaned === INVALID) return INVALID;
      obj[k] = cleaned;
    }
    return obj;
  }
  return INVALID; // function, symbol, bigint, undefined
}
