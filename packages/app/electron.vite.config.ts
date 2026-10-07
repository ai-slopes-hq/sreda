import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import solid from 'vite-plugin-solid';

// Cross-origin isolation (SharedArrayBuffer for the readouts) needs these on every response.
export const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  main: {},
  preload: {
    // a sandboxed preload must be CommonJS
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [solid()],
    server: { headers: ISOLATION, fs: { allow: [resolve(__dirname, '../..')] } },
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
  },
});
