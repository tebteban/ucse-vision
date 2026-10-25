import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: { '/ollama': { target: 'http://127.0.0.1:11434', rewrite: (p) => p.replace(/^\/ollama/, '') } }, // igual que electron.js
  },
  test: {
    include: ['tests/unit/**/*.test.js'], // tests/e2e son de Playwright
    environment: 'node',
  },
})