import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC нужен, чтобы в тестах работали декораторы Nest и метаданные для внедрения зависимостей.
export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
});
