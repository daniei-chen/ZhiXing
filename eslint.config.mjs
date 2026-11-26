import js from '@eslint/js';
import globals from 'globals';
import hooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'release/**',
      'runtime/**',
      '.preview/**',
      '.agents/**',
      'coverage/**',
    ],
  },
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
    rules: { ...js.configs.recommended.rules },
  },
  {
    files: ['*.{js,mjs,cjs}', 'electron/**/*.{js,mjs,cjs}', 'harness/**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': hooks },
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  },
  {
    // Test journeys also contain functions executed inside the browser page.
    files: ['scripts/**/*.{js,mjs,cjs}', 'tests/**/*.{js,jsx,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['worker/**/*.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    // Two documented cleanup guards intentionally throw inside finally to
    // refuse deletion outside their temporary fixture. Keep the control flow.
    files: ['tests/runtime-lifecycle.test.mjs'],
    linterOptions: { noInlineConfig: false, reportUnusedDisableDirectives: 'error' },
  },
];
