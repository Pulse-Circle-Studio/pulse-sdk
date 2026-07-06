import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Fixture } from '@pulse/core/testing';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '../../../protocol/fixtures');

export function loadFixtures(platform: 'web' | 'react-native' | 'ios' | 'android' | null): Fixture[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(FIXTURES_DIR, f), 'utf8')) as Fixture)
    .filter((fixture) => {
      if (!fixture.platforms) return true;
      return platform !== null && fixture.platforms.includes(platform);
    });
}
