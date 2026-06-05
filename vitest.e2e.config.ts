import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  test: {
    include: ['test/e2e/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
  },
})
