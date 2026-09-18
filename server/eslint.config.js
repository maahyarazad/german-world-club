import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default [
  { ignores: ['node_modules/**', 'coverage/**', 'var/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,ts}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // The failure mode of a large migration is not type errors, it is `any`
      // sprayed to silence them (feature 007, research.md R13).
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['tests/**/*.{js,ts}'],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },
]
