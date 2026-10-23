import { defineConfig } from '@playwright/test';

// Pruebas E2E sobre la app de escritorio real (Electron). Antes: npm run build y node tests/fixtures/generar.mjs
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  workers: 1, // una sola app a la vez: comparten cámara falsa y GPU
  retries: 0,
  reporter: [['list']],
});
