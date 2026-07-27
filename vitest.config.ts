import { defineConfig } from 'vitest/config'

<<<<<<< before updating
export default defineConfig({
  test: {
    exclude: ['node_modules/**', 'test/e2e/**'],
  },
})
||||||| last update
export default defineConfig({
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
=======
export default defineConfig({})
>>>>>>> after updating
