import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            minify: false,
            rollupOptions: {
              // Externalize native modules and Node builtins
              external: [
                'electron',
                'better-sqlite3',
                'edge-tts-universal',
                ...builtinModules,
                ...builtinModules.map(m => `node:${m}`),
              ],
              output: {
                // Use CommonJS for Electron main process compatibility
                format: 'cjs',
                entryFileNames: '[name].cjs',
              },
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
              output: {
                format: 'cjs',
                entryFileNames: 'preload.cjs',
              },
            },
          },
        },
      },
      renderer: {},
    }),
  ],
  build: {
    outDir: 'dist_renderer',
  },
  base: './',
})
