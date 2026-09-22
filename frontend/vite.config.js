import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // In development, proxy /api/* to the backend to avoid CORS friction.
      // In production, configure your reverse proxy (nginx, etc.) to do this.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  // Only variables prefixed with VITE_ are exposed to the browser bundle
  envPrefix: 'VITE_',
})
