# Contract: `@gwc/contracts` Public Interface

**Feature**: 007-typescript-migration

The shared package is imported by the server and by every client, so its export
surface is the contract most likely to break something far from the edit. The
rule for this migration: **the runtime export surface does not change.** Only
schemas leave, and nothing imports a schema except the server.

## Export map

`package.json` `exports` keeps all seven subpaths, with `.js` targets becoming
`.ts`:

```jsonc
{
  "exports": {
    "./errors":       "./src/errors.ts",
    "./permissions":  "./src/permissions.ts",
    "./auth":         "./src/auth.ts",
    "./seo":          "./src/seo.ts",
    "./media":        "./src/media.ts",
    "./push":         "./src/push.ts",
    "./capabilities": "./src/capabilities.ts"
  }
}
```

`"dependencies": { "zod": "^4.6.5" }` is removed. The package then has **no
runtime dependencies at all**, which is the one unambiguous improvement in this
half of the feature.

## What each consumer may rely on

**Clients (`client/`, `expo-client/`)** — all ten current import sites are
constants and helpers:

| Import | From | Status |
|---|---|---|
| `PROBLEMS` | `./errors` | unchanged |
| `MODULES`, `FLAGS` | `./permissions` | unchanged, now `as const` unions |
| `HOME_FOR_KIND`, `hasGrant`, `hasAnyGrant`, `isAvailable` | `./capabilities` | unchanged |

No client imports a schema. The console's runtime behaviour is therefore
**identical** before and after, and any client-side change observed during this
migration is a bug introduced by the conversion, not by the removal. That makes
the client the useful control case: convert it first among the consumers and
any behavioural diff is a conversion defect.

**Server** — imports both constants and, today, schemas. After the migration it
imports constants and types. Every `import { fooSchema }` becomes
`import type { Foo }`, which `verbatimModuleSyntax` requires to be spelled with
the `type` keyword.

## Naming rule

`xxxSchema` → `Xxx`. `signInRequestSchema` → `SignInRequest`. Applied uniformly
to all 41 (see data-model.md §2), with no `Schema`-suffixed name surviving —
a surviving one means a schema survived.

## The rule that must not be broken

Principle I's surviving requirement is that a shape has **one** definition. A
type hand-written in `server/src` because the shared one was inconvenient
recreates the exact divergence the package was built to prevent, and after this
feature nothing detects it at runtime.

**Assertion**: no `type`/`interface` declaration in `server/src` or `client/src`
describes a request or response body. Those live in `packages/contracts` only.
This is the one Principle I guarantee that outlives the amendment, and it is
checkable by lint rather than by review.

## Contract assertions

1. All seven subpath exports resolve from server and client.
2. `grep -r "from 'zod'" packages/contracts/` returns nothing.
3. `packages/contracts/package.json` has no `dependencies` key.
4. Every client import site listed above compiles unchanged.
5. No `Schema`-suffixed export remains.
