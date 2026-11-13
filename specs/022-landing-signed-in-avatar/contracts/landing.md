# Contract: the landing pages for a signed-in visitor

Routes `GET /` and `GET /en` are unchanged in posture (`audience: 'public'`).

| Visitor | Masthead | Sign-in section | `cache-control` | Extra `vary` |
|---|---|---|---|---|
| Anonymous, or any invalid, expired or revoked session, or an inadmissible account | `<a class="btn btn-primary" href="/konsole/anmelden">Anmelden</a>` (unchanged) | unchanged | `public, max-age=300, stale-while-revalidate=86400` (unchanged) | none |
| Member with an avatar | `<a class="account" href="/konsole" aria-label="Zur Konsole – {name}"><img src="{derivative url}" alt="" width="40" height="40"></a>` | `<a class="btn btn-primary" href="/konsole">Zur Konsole</a>` | `private, no-store` | `Cookie` |
| Member without an avatar, staff, merchant, partner | the same link with `<span class="initials" aria-hidden="true">{AB}</span>` | the same | `private, no-store` | `Cookie` |

English (`/en`) labels: "Go to the console – {name}" and "Go to the console".

Markers in both shells (must exist; a test checks them):

```html
<!--gwc:account--> …sign-in button… <!--/gwc:account-->
<!--gwc:signin--> …login-actions… <!--/gwc:signin-->
```

`{name}`, `{AB}` and `{derivative url}` are HTML-escaped. The page carries no `<script>`.
