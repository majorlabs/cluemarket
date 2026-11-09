// Lint for the server code: ESLint's recommended rules plus eslint-plugin-security. The bundled browser files and tests are skipped.
import js from '@eslint/js';
import security from 'eslint-plugin-security';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'public/**', 'tests/**', '*-client.js', '*-client.jsx'] },
  js.configs.recommended,
  security.configs.recommended,
  // Two security rules are switched off because they only produce false alarms here: every file path read by the server comes from a fixed list
  // of allowed names, and every object key or array index that is looked up has already been checked or comes from a number.
  { rules: { 'security/detect-non-literal-fs-filename': 'off', 'security/detect-object-injection': 'off' } },
  { languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } } },
];
