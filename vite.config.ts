/// <reference types="vitest" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    test: {
      // The shell manifest imports real React components, which reach DOM APIs
      // at module scope. This is a desktop app; a DOM is the honest baseline.
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      // The registry contract test enumerates feature directories from disk, so
      // tests must run from the repository root.
      root: __dirname,
    },
    define: {
      "process.env.IS_PREACT": JSON.stringify("false"),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
