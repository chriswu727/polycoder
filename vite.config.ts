import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: 'src',
  base: './',
  build: {
    outDir: '../dist/renderer',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    // Cross-origin isolation headers required for WebContainer in
    // the Sandbox tab (SharedArrayBuffer needs both). Inert for the
    // rest of the renderer, safe to enable unconditionally in dev.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
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
