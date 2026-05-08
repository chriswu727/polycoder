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
