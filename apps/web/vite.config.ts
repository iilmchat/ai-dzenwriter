/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vite';

// Корневой .env читаем без побочных эффектов. loadEnv из Vite пишет переменные в process.env,
// и NODE_ENV из .env тогда выбирает development-JSX в production-сборке React.
const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url));
const dotenv: Record<string, string | undefined> = existsSync(rootEnvFile)
  ? parseEnv(readFileSync(rootEnvFile, 'utf8'))
  : {};
const setting = (key: string, fallback: string): string =>
  process.env[key] ?? dotenv[key] ?? fallback;

// Порты и адрес API согласованы с тем, что читает сам API: dev-сервер, предпросмотр и API
// используют одни и те же значения из .env.
const apiTarget = setting('API_PROXY_TARGET', `http://127.0.0.1:${setting('API_PORT', '4000')}`);
const proxy = {
  '/api': { target: apiTarget },
  '/health': { target: apiTarget },
  '/ready': { target: apiTarget },
};

// Vite 8 собирает через Rolldown: вместо rollupOptions.output.manualChunks
// группы чанков задаются через output.codeSplitting.groups.
const VENDOR_GROUPS = [
  {
    name: 'codemirror',
    test: /[\\/]node_modules[\\/](?:@codemirror|@lezer|codemirror|style-mod|w3c-keyname|crelt)[\\/]/,
  },
  {
    name: 'markdown',
    test: /[\\/]node_modules[\\/](?:react-markdown|remark-[^\\/]+|rehype-[^\\/]+|unified|mdast-[^\\/]+|hast-[^\\/]+|micromark[^\\/]*|vfile[^\\/]*|unist-[^\\/]+)[\\/]/,
  },
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: VENDOR_GROUPS,
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: Number(setting('WEB_DEV_PORT', '5173')),
    strictPort: true,
    proxy,
  },
  preview: {
    host: '127.0.0.1',
    port: Number(setting('WEB_PREVIEW_PORT', '4173')),
    strictPort: true,
    proxy,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    // Два тяжёлых теста поднимают CodeMirror и jsdom. Один worker не конкурирует
    // за память с тестами API, которые turbo запускает параллельно.
    maxWorkers: 1,
  },
});
