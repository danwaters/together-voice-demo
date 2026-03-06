import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5180,
    proxy: {
      '/ws': {
        target: 'ws://localhost:8800',
        ws: true,
      },
      '/health': {
        target: 'http://localhost:8800',
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
