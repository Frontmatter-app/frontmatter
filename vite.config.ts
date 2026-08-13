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
    build: {
      rollupOptions: {
        output: {
          // The app shipped as one 3.6 MB chunk, so any change invalidated the
          // whole download. Splitting the large, rarely-changing dependencies
          // lets the browser cache them across releases.
          manualChunks: {
            react: ['react', 'react-dom'],
            firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/functions'],
            codemirror: [
              '@codemirror/view',
              '@codemirror/state',
              '@codemirror/commands',
              '@codemirror/language',
              '@codemirror/search',
              '@codemirror/lang-markdown',
            ],
            // y-protocols exposes no root entry, only subpaths, so it is left
            // for Rollup to place alongside its importers.
            yjs: ['yjs', 'y-codemirror.next'],
          },
        },
      },
    },
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
