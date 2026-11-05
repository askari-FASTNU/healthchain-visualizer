import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';

// Builds the whole app (code, styles, fonts, worker) into one dist/index.html
// so it can be opened by double-clicking, with no server and no internet.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      '@fonts': path.resolve(__dirname, 'node_modules/@fontsource'),
    },
  },
  worker: { format: 'iife' },
  build: { assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 5000 },
});
