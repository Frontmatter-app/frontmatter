/// <reference types="vitest" />
import { defineConfig } from 'vite';

/**
 * Security rules tests run separately from the app suite: they need a live
 * Firestore emulator (and so a Java runtime), which `npm test` must not require.
 *
 *   npm run test:rules
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    // Rules evaluation against the emulator is slower than in-process work, and
    // the suites share one emulator, so they must not run in parallel.
    fileParallelism: false,
    testTimeout: 20000,
    root: __dirname,
  },
});
