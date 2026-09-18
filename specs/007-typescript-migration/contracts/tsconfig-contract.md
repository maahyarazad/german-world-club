# Contract: TypeScript Configuration

**Feature**: 007-typescript-migration

The compiler configuration is a contract because every workspace depends on the
same answers. Values marked **REQUIRED** are load-bearing — changing one either
breaks the runtime or silently stops the checking.

## Root: `tsconfig.base.json`

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",

    // REQUIRED. Nothing is emitted; Node strips types at runtime (R1)
    // and this pass exists only to fail the build on a type error.
    "noEmit": true,

    // REQUIRED. Rejects enum, namespace and parameter properties at
    // compile time — the syntax Node's stripper cannot erase. Without it
    // the error surfaces at runtime as ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX,
    // in production, on the one code path nobody exercised.
    "erasableSyntaxOnly": true,

    // REQUIRED. Type-only imports must say so, because the stripper
    // removes them without consulting the type graph.
    "verbatimModuleSyntax": true,

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  }
}
```

`erasableSyntaxOnly` and `verbatimModuleSyntax` are the two settings that make
`tsc --noEmit` a faithful proxy for what Node will accept. Omitting either lets
the checker pass code the runtime refuses.

`noUncheckedIndexedAccess` is not required, but it is the single setting that
recovers most of what the removed request validation used to provide: it forces
the server to acknowledge that an index into a parsed body may be absent.

## `server/tsconfig.json` and `packages/contracts/tsconfig.json`

```jsonc
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    // REQUIRED. Source says `./env.ts` because Node resolves the literal
    // specifier (R2). TypeScript permits this only with noEmit.
    "allowImportingTsExtensions": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

`include` covers `tests/` deliberately. Vitest transpiles without checking, so
a test excluded here is unchecked (R5) — and tests are 74 of the server's 194
files.

## `client/tsconfig.json`

```jsonc
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "tests/**/*.tsx",
              "scripts/**/*.ts", "vite.config.ts"]
}
```

The client differs on purpose: Vite resolves specifiers, so `bundler` resolution
applies and `allowImportingTsExtensions` is absent — client imports go
extensionless (R2).

## Contract assertions

1. `npx tsc --noEmit -p .` at the root exits zero.
2. A file containing `enum X {}` fails the check before it can fail at runtime.
3. A server file importing `'./env.js'` fails to resolve at runtime; a file
   importing `'./env.ts'` resolves. The configuration must match the second.
4. Removing a `tests/**` entry from `include` causes no check failure — which
   is the failure mode this contract exists to prevent. Verify by introducing a
   deliberate type error in a test file and confirming the root check fails.
