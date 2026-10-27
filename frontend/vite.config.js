import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development the API and Socket.IO are proxied to the backend, so the
// browser sees a single origin and SameSite cookies work without CORS.
const backend = process.env.VITE_DEV_BACKEND || 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Fail instead of silently moving to 5174: the backend only allows the
    // origin configured in FRONTEND_URL (http://localhost:5173 by default).
    strictPort: true,
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/socket.io': { target: backend, ws: true, changeOrigin: false },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          scanner: ['html5-qrcode'],
        },
      },
    },
  },
});
