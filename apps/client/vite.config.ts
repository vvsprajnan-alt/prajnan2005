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
    chunkSizeWarningLimit: 1200,
  },
});
