import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'api/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // Defense in depth: service worker and Node scripts carry their own runtime
  // globals. Without these blocks a bare `eslint .` drowns in no-undef.
  {
    files: ['public/sw.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        clients: 'readonly',
        skipWaiting: 'readonly',
        importScripts: 'readonly',
        location: 'readonly',
        console: 'readonly',
        Promise: 'readonly',
        Event: 'readonly',
        ExtendableEvent: 'readonly',
        FetchEvent: 'readonly',
      },
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        TextEncoder: 'readonly',
        URL: 'readonly',
      },
    },
  },
)
