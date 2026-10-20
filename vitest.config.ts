import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'pipeline/**/*.test.ts', 'web/test/**/*.test.ts'],
  },
});
