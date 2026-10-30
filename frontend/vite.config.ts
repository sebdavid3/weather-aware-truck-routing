import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // In development the Django API runs on its own port; proxying keeps
    // the browser on one origin, so no CORS setup is needed locally.
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
