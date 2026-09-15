import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['node_modules/**', 'test/e2e/**'],
    // Spelled out (matching Vitest's own default) so knip's static analysis
    // of this file can resolve test entry files; Vitest's own runtime
    // behavior is unchanged.
    include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  },
})
