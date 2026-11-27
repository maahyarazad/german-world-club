/**
 * The rendered error page: what a browser sees at a path that does not exist (the 404 above
 * all), and at the other refusals the error handler answers with HTML.
 *
 * It looks like the landing page (`client/index.html`): the same white masthead with the logo,
 * the same ink block with a gold rule and gold figures, the same footer. An earlier version kept
 * the palette of the club's previous site, so a stray link led from a navy-and-gold page to a
 * burgundy one.
 *
 * Both languages are on the page at once. The platform serves one URL per language and picks it by
 * LINK, never by `Accept-Language` (CLAUDE.md, "Two languages, two mechanisms"), and an error has no
 * URL of its own to pick from: a mistyped path may belong to either language. German leads, English
 * follows in a block marked `lang="en"` so a screen reader changes voice.
 *
 * Constraints that shaped it, so a later edit does not undo them:
 *  - No JavaScript, and no `style=` attribute: styles are one `<style>` carrying the request's CSP
 *    nonce. Real content in the first response, never indexable (`noindex`, and the handler sends
 *    `x-robots-tag` too).
 *  - It never echoes the requested path or query string. A path is user input, and the error
 *    handler records the route pattern and not the URL for the same reason.
 *  - Every value that is not a literal here goes through `escape`.
 *  - The logo carries its intrinsic dimensions (Principle VI), and is the only image: `img-src` is
 *    `'self'` and `data:`.
 *  - The reference (the request id) stays on the page: it is what a person quotes to support, and
 *    what a recorded server fault is keyed on.
 */
const escape = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

type Words = { title: string; body: string }
type Copy = { de: Words; en: Words }

// Impersonal on purpose (no du, no Sie): the landing page and the console do not agree on one,
// and a page that anyone can reach should not pick.
const NOT_FOUND: Copy = {
  de: {
    title: 'Diese Seite gibt es nicht',
    body: 'Die Adresse stimmt nicht, oder die Seite wurde verschoben. Von der Startseite aus geht es weiter.',
  },
  en: {
    title: 'Page not found',
    body: 'The address may be mistyped, or the page has moved. The home page is the place to pick up again.',
  },
}

const FORBIDDEN: Copy = {
  de: { title: 'Kein Zugriff', body: 'Für diese Seite fehlt die Berechtigung. Von der Startseite aus geht es weiter.' },
  en: { title: 'Access denied', body: 'This page needs permission that is not there. The home page is the place to pick up again.' },
}

const TOO_MANY: Copy = {
  de: { title: 'Einen Moment bitte', body: 'Es gab zu viele Anfragen in kurzer Zeit. Nach einer kurzen Pause geht es weiter.' },
  en: { title: 'Too many requests', body: 'There were too many requests in a short time. After a short pause, try again.' },
}

const FAILED: Copy = {
  de: { title: 'Hier ist etwas schiefgelaufen', body: 'Das liegt nicht an der Adresse. Ein neuer Versuch in einer Minute hilft meist.' },
  en: { title: 'Something went wrong', body: 'It is not the address. Trying again in a minute usually helps.' },
}

function copyFor(status: number, title: string): Copy {
  if (status === 404) return NOT_FOUND
  if (status === 403) return FORBIDDEN
  if (status === 429) return TOO_MANY
  if (status >= 500) return FAILED
  // Any other refusal: the problem's own (English) title, with a plain German line above it.
  return {
    de: { title: 'Das hat nicht geklappt', body: 'Die Anfrage konnte nicht ausgeführt werden. Von der Startseite aus geht es weiter.' },
    en: { title, body: 'The request could not be completed. The home page is the place to pick up again.' },
  }
}

export type ErrorPageInput = {
  status: number
  /** The problem's title, in English: used where this file has no wording of its own for the status. */
  title: string
  requestId?: string | undefined
  nonce?: string | undefined
}

export function errorPage({ status, title, requestId, nonce }: ErrorPageInput): string {
  const n = nonce ? ` nonce="${escape(nonce)}"` : ''
  const copy = copyFor(status, title)
  const reference = requestId
    ? `<p class="ref">Referenz / Reference <code>${escape(requestId)}</code></p>`
    : ''

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escape(status)} — ${escape(copy.de.title)} · ${escape(copy.en.title)}</title>
<link rel="icon" sizes="32x32" href="/favicon-32x32.png">
<style${n}>
  :root { --navy:#0a2457; --accent:#d49626; --ink:#171b20; --ground:#f7f8fa; --surface:#fff;
          --text:#171b20; --hairline:#d9dee4; --soft:#d7dce2; --muted:#aab2bb; --radius:.5rem }
  *, *::before, *::after { box-sizing:border-box }
  html { -webkit-text-size-adjust:100% }
  body { margin:0; min-height:100svh; display:flex; flex-direction:column; background:var(--ground);
         color:var(--text); font-family:"GWC Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,
         "Helvetica Neue",Arial,sans-serif; font-size:15px; line-height:1.6 }
  a { color:var(--navy) }
  .wrap { width:100%; max-width:68rem; margin:0 auto; padding:0 1rem }
  .sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap }
  .skip { position:absolute; left:-9999px }
  .skip:focus { left:1rem; top:1rem; z-index:50; background:var(--surface); padding:.625rem 1rem;
                border-radius:var(--radius); border:1px solid var(--hairline) }

  .masthead { background:var(--surface); border-bottom:1px solid var(--hairline) }
  .masthead .wrap { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between;
                    gap:.75rem; padding-top:.75rem; padding-bottom:.75rem }
  .masthead img { display:block; height:4rem; width:auto }

  .btn { display:inline-block; border-radius:var(--radius); padding:.7rem 1.1rem; font-size:.8125rem;
         font-weight:600; text-decoration:none }
  .btn-primary { background:var(--navy); color:#fff }
  .btn-accent { background:var(--accent); color:var(--ink) }
  .btn-ghost { color:#fff; border:1px solid rgba(255,255,255,.4) }
  .btn:hover { filter:brightness(1.08) }
  .masthead a:focus-visible { outline:2px solid var(--navy); outline-offset:2px }
  main a:focus-visible, footer a:focus-visible { outline:2px solid var(--accent); outline-offset:2px }

  main { position:relative; overflow:hidden; flex:1; display:flex; align-items:center; background:var(--ink); color:#fff }
  main .wrap { position:relative; padding-top:3.5rem; padding-bottom:3.5rem }
  /* Two interlocked rings, as in the emblem: decoration only, drawn in CSS so the page still has one
     image. They sit behind the text and are dropped where there is no room beside it. */
  .rings { position:absolute; top:50%; right:max(1rem,calc((100% - 68rem) / 2 + 1rem)); width:26rem; height:16rem;
           transform:translateY(-50%); pointer-events:none }
  .rings::before, .rings::after { content:""; position:absolute; top:0; width:16rem; height:16rem;
                                  border-radius:50%; border:3px solid rgba(212,150,38,.4) }
  .rings::before { left:0 }
  .rings::after { right:0; border-color:rgba(212,150,38,.2) }
  .code { margin:0; font-size:clamp(5rem,22vw,10rem); line-height:.9; font-weight:800;
          letter-spacing:-.05em; color:var(--accent) }
  .rule { width:5rem; height:3px; background:var(--accent); margin:1.5rem 0 }
  h1 { margin:0; font-size:clamp(1.75rem,6vw,2.75rem); line-height:1.15; letter-spacing:-.02em; font-weight:700 }
  .lede { margin:1rem 0 0; max-width:38rem; font-size:1.0625rem; color:var(--soft) }
  .en { margin-top:2rem; padding-top:1.5rem; max-width:38rem; border-top:1px solid rgba(255,255,255,.16) }
  .en-title { margin:0; font-size:1.125rem; font-weight:600 }
  .en .lede { margin-top:.375rem; font-size:.9375rem; color:var(--muted) }
  .actions { display:flex; flex-wrap:wrap; gap:.75rem; margin-top:2rem }
  .ref { margin:2.5rem 0 0; font-size:.75rem; color:var(--muted) }
  .ref code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:var(--accent);
              overflow-wrap:anywhere }

  footer { background:var(--ink); color:var(--soft); border-top:1px solid rgba(255,255,255,.12); font-size:.8125rem }
  footer .wrap { display:flex; flex-wrap:wrap; justify-content:space-between; gap:.5rem 1.5rem;
                 padding-top:1.25rem; padding-bottom:1.25rem }
  footer a { color:var(--soft) }
  footer strong { color:var(--accent); letter-spacing:.04em }

  @media (max-width:72rem) { .rings { display:none } }
  @media (max-width:30rem) {
    .masthead img { height:3.25rem }
    main .wrap { padding-top:2.5rem; padding-bottom:2.5rem }
  }
</style>
</head>
<body>
  <a class="skip" href="#inhalt">Zum Inhalt springen</a>

  <header class="masthead">
    <div class="wrap">
      <a href="/"><img src="/gwc-logo.png" alt="German World Club, Startseite" width="844" height="578"></a>
      <a class="btn btn-primary" href="/konsole/anmelden">Anmelden</a>
    </div>
  </header>

  <main id="inhalt">
    <div class="rings" aria-hidden="true"></div>
    <div class="wrap">
      <p class="code" aria-hidden="true">${escape(status)}</p>
      <div class="rule"></div>
      <h1><span class="sr">Fehler ${escape(status)}: </span>${escape(copy.de.title)}</h1>
      <p class="lede">${escape(copy.de.body)}</p>

      <div class="en" lang="en">
        <p class="en-title">${escape(copy.en.title)}</p>
        <p class="lede">${escape(copy.en.body)}</p>
      </div>

      <div class="actions">
        <a class="btn btn-accent" href="/">Zur Startseite</a>
        <a class="btn btn-ghost" href="/en" lang="en" hreflang="en">Home (English)</a>
      </div>
      ${reference}
    </div>
  </main>

  <footer>
    <div class="wrap">
      <strong>German World Club</strong>
      <span><a href="/impressum">Impressum</a> · <a href="/datenschutz">Datenschutz</a></span>
    </div>
  </footer>
</body>
</html>
`
}
