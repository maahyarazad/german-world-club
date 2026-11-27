import { describe, it, expect } from 'vitest'
import { errorPage } from '../../src/modules/public/templates/error-page.ts'

/**
 * The rendered error page (what a browser sees at a path that does not exist).
 *
 * `errorPage` is a pure function, so this runs without a database. The HTTP side (status, headers,
 * the request id agreeing with `x-request-id`) is in error-envelope.test.ts.
 *
 * Each case has the assertion that would pass for a page that did the wrong thing, turned round:
 * hostile input is escaped *and* the same input in a literal is left alone, and "no inline style"
 * is checked on a page that does have a `<style>`.
 */
const ID = '01JD3K8Q7Z4X9VWB2N5M6TRHPE'
const page = (over: Partial<Parameters<typeof errorPage>[0]> = {}) =>
  errorPage({ status: 404, title: 'Page not found', requestId: ID, nonce: 'abc123', ...over })

describe('the 404 page', () => {
  it('says so in German first and in English after, each marked with its language', () => {
    const html = page()
    expect(html).toContain('<html lang="de">')
    expect(html).toContain('Diese Seite gibt es nicht')
    // The English block is its own `lang="en"` element, so a screen reader changes voice.
    expect(html).toMatch(/<div class="en" lang="en">\s*<p class="en-title">Page not found<\/p>/)
    expect(html.indexOf('Diese Seite gibt es nicht')).toBeLessThan(html.indexOf('Page not found</p>'))
    // The title names the status in both languages, so a tab and a search history read right.
    expect(html).toContain('<title>404 — Diese Seite gibt es nicht · Page not found</title>')
  })

  it('tells a screen reader the status, and hides the big figure from it', () => {
    const html = page()
    expect(html).toContain('<h1><span class="sr">Fehler 404: </span>Diese Seite gibt es nicht</h1>')
    expect(html).toContain('<p class="code" aria-hidden="true">404</p>')
  })

  it('offers a way on: the home page in both languages, and sign-in', () => {
    const html = page()
    expect(html).toContain('<a class="btn btn-accent" href="/">Zur Startseite</a>')
    expect(html).toContain('href="/en" lang="en" hreflang="en">Home (English)</a>')
    expect(html).toContain('href="/konsole/anmelden"')
  })

  it('keeps the reference, which is what a person quotes to support', () => {
    expect(page()).toContain(`Referenz / Reference <code>${ID}</code>`)
    // Counter-assertion: with no id there is no empty reference line.
    expect(page({ requestId: undefined })).not.toContain('class="ref"')
  })

  it('draws the logo with its intrinsic dimensions, and is the only image', () => {
    const html = page()
    expect(html).toContain('<img src="/gwc-logo.png" alt="German World Club, Startseite" width="844" height="578">')
    expect(html.match(/<img /g)).toHaveLength(1)
  })

  it('is never indexable and runs no script', () => {
    const html = page()
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">')
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/\son[a-z]+=/i)
  })
})

describe('what it must not do', () => {
  it('has no inline style attribute (the CSP allows styles by nonce) and puts the nonce on its one <style>', () => {
    const html = page()
    expect(html).not.toMatch(/\sstyle="/)
    expect(html).toContain('<style nonce="abc123">')
    // Counter-assertion: the page does have a <style>, so the check above is not vacuous.
    expect(html.match(/<style/g)).toHaveLength(1)
    // And without a nonce it is a plain <style>, as before.
    expect(page({ nonce: undefined })).toContain('<style>')
  })

  it('escapes what it is given, and leaves its own wording alone', () => {
    const hostile = '"><script>alert(1)</script>'
    const html = page({ status: 418, title: hostile, requestId: hostile, nonce: hostile })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
    // The fixed German wording has no special characters to escape; an umlaut must survive.
    expect(page({ status: 500, title: 'x' })).toContain('Hier ist etwas schiefgelaufen')
    expect(html).toContain('Von der Startseite aus geht es weiter')
  })

  it('takes nothing from the request: it has no parameter for the path, so it cannot echo one', () => {
    // The handler passes status, title, id and nonce, and nothing else, because a path is user input.
    expect(errorPage.length).toBe(1)
    expect(page()).not.toMatch(/\/nope|\?x=/)
  })
})

describe('the other statuses use the same page', () => {
  const words = (status: number, title = 'Whatever') => {
    const html = page({ status, title })
    return {
      de: html.match(/<h1>.*?<\/span>(.*?)<\/h1>/)?.[1],
      en: html.match(/class="en-title">(.*?)<\/p>/)?.[1],
      code: html.match(/class="code" aria-hidden="true">(.*?)<\/p>/)?.[1],
    }
  }

  it('has its own wording for 403, 429 and every 5xx', () => {
    expect(words(403)).toEqual({ de: 'Kein Zugriff', en: 'Access denied', code: '403' })
    expect(words(429)).toEqual({ de: 'Einen Moment bitte', en: 'Too many requests', code: '429' })
    for (const status of [500, 502, 503, 504]) {
      expect(words(status)).toEqual({ de: 'Hier ist etwas schiefgelaufen', en: 'Something went wrong', code: String(status) })
    }
  })

  it('falls back to the problem\'s own English title for a status it has no wording for', () => {
    expect(words(409, 'Conflict')).toEqual({ de: 'Das hat nicht geklappt', en: 'Conflict', code: '409' })
    // Counter-assertion: a 404 ignores the title it is given, so the page cannot be made to say something else.
    expect(words(404, 'Something else entirely').en).toBe('Page not found')
  })
})
