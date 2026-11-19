import { defineConfig } from 'vite';

export default defineConfig({
  // 5183, and not Vite's usual 5173, which another project on the same machine may be using
  server: { host: '127.0.0.1', port: 5183 },
  preview: { host: '127.0.0.1', port: 4183 },
  // lets several dev servers run side by side without sharing one dependency cache
  cacheDir: process.env.LODESTAR_VITE_CACHE || 'node_modules/.vite',
  build: {
    target: 'es2022',
    // the game and three.js ship as one chunk; nothing is loaded later
    chunkSizeWarningLimit: 2500,
  },
});
