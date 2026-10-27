import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    // API and realtime requests both go to the .env-aware Node server (npm run server).
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080' },
      '/ws': { target: 'ws://127.0.0.1:8080', ws: true },
    },
  },
  test: { environment: 'node' },
});
