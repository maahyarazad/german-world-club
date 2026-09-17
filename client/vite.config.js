import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  /**
   * Two entries that share nothing but the build.
   *
   * `index.html` is the public landing page: German, indexed, and entirely
   * static — its content and its styling are inline, so a crawler that executes
   * no JavaScript still gets the whole page (Constitution "Public rendering").
   * It pulls in no bundle at all.
   *
   * `konsole.html` is the gated console: React, client-routed, never indexed.
   *
   * There was previously an `async-css` plugin here that rewrote stylesheet
   * links to `media="print"` with an `onload` swap. It existed so the old
   * React coming-soon page could paint its inline boot shell before the
   * Tailwind sheet arrived. The landing page now carries its own styles inline
   * and needs no sheet, and applying that trick to the console would have made
   * its first paint depend on JavaScript for no benefit — so the plugin is gone
   * rather than carried forward.
   */
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        konsole: resolve(__dirname, 'konsole.html'),
      },
    },
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './tests/setup.js',
    css: true,
  },
})
