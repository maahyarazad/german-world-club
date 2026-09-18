/** Minimal rendered error page. Carries real content in the first response and
 *  is never indexable. */
const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function errorPage({ status, title, requestId, nonce }) {
  const n = nonce ? ` nonce="${escape(nonce)}"` : ''
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escape(status)} — ${escape(title)}</title>
<style${n}>
  :root { color-scheme: dark }
  body { margin:0; min-height:100svh; display:flex; align-items:center; justify-content:center;
         background:linear-gradient(180deg,#750a04 0%,#4a0603 58%,#1a0b0a 100%); color:#fff8f0;
         font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
         text-align:center; padding:2rem }
  h1 { font-family:ui-serif,Georgia,serif; font-weight:500; font-size:clamp(2rem,8vw,3.5rem); margin:0 }
  p  { color:#f5d0d0; margin:1.25rem 0 0; line-height:1.7 }
  code { color:#c9a227; font-size:.8rem }
  a { color:#c9a227 }
</style>
</head>
<body>
  <main>
    <h1>${escape(status)}</h1>
    <p>${escape(title)}</p>
    <p><a href="/">German World Club</a></p>
    <p><code>${escape(requestId ?? '')}</code></p>
  </main>
</body>
</html>
`
}
