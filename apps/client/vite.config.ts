import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    // Multiplayer in development: run `npm run dev:server` alongside.
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  preview: { host: true, port: 4173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Long-lived vendor and simulation chunks: a game update rarely invalidates the cached three.js.
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
          if (id.includes('packages/sim/') || id.includes('packages/net/')) return 'sim';
          return undefined;
        },
      },
    },
  },
});
