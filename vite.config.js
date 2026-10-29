import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    // Google popup sign-in on HTTP localhost uses these development-only headers.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      'Referrer-Policy': 'no-referrer-when-downgrade',
    },
    // Preserve the browser Host so backend same-site checks and cookies work
    // for sign-in, sign-out and API requests through the local development server.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080' },
      '/auth': { target: 'http://127.0.0.1:8080' },
      '/ws': { target: 'ws://127.0.0.1:8080', ws: true },
    },
  },
  test: { environment: 'node' },
});
