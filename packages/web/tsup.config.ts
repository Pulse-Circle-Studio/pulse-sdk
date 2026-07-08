import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    // @pulse-circle/core is bundled in: zero runtime dependencies for consumers.
    noExternal: ['@pulse-circle/core'],
    minify: true,
  },
  {
    entry: { 'pulse.iife': 'src/umd.ts' },
    format: ['iife'],
    sourcemap: true,
    noExternal: ['@pulse-circle/core'],
    minify: true,
  },
]);
