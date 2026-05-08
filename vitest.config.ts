import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'core/**/*.test.ts',
      'providers/**/*.test.ts',
      'tools/**/*.test.ts',
      'data/**/*.test.ts',
      'electron/**/*.test.ts',
    ],
    exclude: ['node_modules', 'dist', 'build'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      exclude: ['node_modules', 'dist', 'build', '**/*.test.ts', '**/*.config.ts'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@core': resolve(__dirname, 'core'),
      '@providers': resolve(__dirname, 'providers'),
      '@tools': resolve(__dirname, 'tools'),
      '@data': resolve(__dirname, 'data'),
    },
  },
})
