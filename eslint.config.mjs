export default [{
  files: ['src/**/*.mjs', 'test/**/*.mjs', 'eslint.config.mjs'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { Buffer: 'readonly', process: 'readonly', console: 'readonly', URL: 'readonly' } },
  rules: { 'no-unused-vars': 'error', 'no-undef': 'error', 'no-unreachable': 'error', 'eqeqeq': 'error' },
}];
