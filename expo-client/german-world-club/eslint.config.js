// https://docs.expo.dev/guides/using-eslint/ (SDK 57, flat config)
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*', 'ios/*'],
  },
  {
    // Feature 036: styles live in `StyleSheet.create`, never as an object literal in
    // JSX. A value that exists only at runtime (an aspect ratio from an image's own
    // size) may stay inline with an `eslint-disable-next-line` comment giving the reason.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name=/[sS]tyle$/] > JSXExpressionContainer > ObjectExpression',
          message: 'Inline style object: move it to StyleSheet.create (theme colours: useThemedStyles).',
        },
        {
          selector: 'JSXAttribute[name.name=/[sS]tyle$/] > JSXExpressionContainer > ArrayExpression > ObjectExpression',
          message: 'Inline style object in a style array: move it to StyleSheet.create (theme colours: useThemedStyles).',
        },
      ],
    },
  },
]);
