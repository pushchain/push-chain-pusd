import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import path from 'path'
import { defineConfig } from 'vite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      buffer: 'buffer',
      process: 'process/browser',
      util: 'util',
    },
  },
  define: {
    'process.env': {},
    global: 'globalThis',
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
})
