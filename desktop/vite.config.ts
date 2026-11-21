import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: __dirname,
  base: './',
  build: {
    outDir: path.join(__dirname, 'dist', 'renderer'),
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: false,
  },
  server: {
    port: 5199,
    strictPort: true,
    host: true,
    // Only the exact preview host supplied to the process is allowed; there is
    // no wildcard fallback.
    allowedHosts: process.env.OPENLINK_PREVIEW_HOST ? [process.env.OPENLINK_PREVIEW_HOST] : [],
  },
  resolve: {
    alias: {
      '@shared': path.join(__dirname, '..', 'shared'),
    },
  },
});
