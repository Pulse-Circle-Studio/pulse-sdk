import path from 'node:path';
import { defineConfig } from 'vitest/config';

const pkg = (...parts: string[]) => path.resolve(import.meta.dirname, 'packages', ...parts);

export default defineConfig({
  resolve: {
    alias: {
      '@pulse-circle/core/testing': pkg('core', 'src', 'testing.ts'),
      '@pulse-circle/core': pkg('core', 'src', 'index.ts'),
      '@pulse-circle/web': pkg('web', 'src', 'index.ts'),
      '@pulse-circle/react-native': pkg('react-native', 'src', 'index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
