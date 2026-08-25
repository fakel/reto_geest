import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Both setup files run for every test file. The API setup installs the
    // API Prisma singleton + api env vars; the worker setup installs the
    // worker Prisma singleton + worker env vars. They operate on separate
    // pg-mem instances, so the (harmless) cross-registration is unused.
    setupFiles: [
      'packages/api/tests/setup.ts',
      'packages/worker/tests/setup.ts',
    ],
    include: [
      'packages/api/tests/**/*.test.ts',
      'packages/worker/tests/**/*.test.ts',
    ],
  },
});
