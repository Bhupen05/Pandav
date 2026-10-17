import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'uploads/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // Parameters a signature needs but the body doesn't use start with _
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];
