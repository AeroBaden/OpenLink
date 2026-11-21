import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: __dirname,
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome114',
    sourcemap: false,
  },
  server: {
    allowedHosts: process.env.OPENLINK_PREVIEW_HOST ? [process.env.OPENLINK_PREVIEW_HOST] : [],
    port: 5200,
    strictPort: true,
    host: true,
  },
  resolve: {
    alias: {
      '@shared': path.join(__dirname, '..', 'shared'),
    },
  },
});
