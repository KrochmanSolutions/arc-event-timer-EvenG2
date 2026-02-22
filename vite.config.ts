import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    host: true,
    port: 3002,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
