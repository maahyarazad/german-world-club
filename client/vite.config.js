import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'


/**
 * The boot shell in index.html is styled entirely by inline critical CSS, so
 * the generated Tailwind stylesheet does not need to block the first paint.
 * Load it asynchronously and let it apply once it arrives; React only mounts
 * after the (much larger) JS bundle, by which time the sheet is in place.
 */
function asyncCss() {
  return {
    name: 'async-css',
    enforce: 'post',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        /<link rel="stylesheet"([^>]*?)href="([^"]+)"([^>]*)>/g,
        (_m, pre, href, post) =>
          `<link rel="stylesheet"${pre}href="${href}"${post} media="print" onload="this.media='all';this.onload=null">` +
          `<noscript><link rel="stylesheet"${pre}href="${href}"${post}></noscript>`,
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), asyncCss()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './tests/setup.js',
    css: true,
  },
})
