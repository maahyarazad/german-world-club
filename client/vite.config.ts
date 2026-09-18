import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
// vitest/config, not vite: this file carries a `test` block, which Vite's
// own UserConfig does not describe.
import { defineConfig } from 'vitest/config'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { consoleFallback, apiProxy } from './dev-server'

const __dirname = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [consoleFallback(), react(), tailwindcss()],

  /**
   * The dev server has to imitate two things the Fastify server does in
   * production, or the console is unreachable from the landing page:
   * serve the console entry for `/konsole/*`, and put the API on this origin.
   * See dev-server.js for why each is needed and what Vite does without them.
   */
  server: {
    proxy: apiProxy(),
  },

  /**
   * Two entries that share nothing but the build.
   *
   * `index.html` and `en.html` are the public landing pages — German and
   * English, one URL each. Both are entirely static: content and styling
   * inline, so a crawler that executes no JavaScript still gets the whole page
   * (Constitution "Public rendering"). Neither pulls in a bundle.
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
        // The English landing page. A separate document, not a runtime branch:
        // it has its own <html lang>, its own canonical and its own copy, and
        // it must render with no JavaScript like its German twin.
        en: resolve(__dirname, 'en.html'),
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
