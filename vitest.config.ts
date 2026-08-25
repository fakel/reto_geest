import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['packages/api/tests/setup.ts'],
    include: ['packages/api/tests/**/*.test.ts'],
  },
});