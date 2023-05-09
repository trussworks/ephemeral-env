module.exports = {
  root: true,
  parserOptions: {
    project: ['./tsconfig.json'], // Specify it only for TypeScript files
  },
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  rules: {
    '@typescript-eslint/require-await': 'error',
    '@typescript-eslint/return-await': 'error',
  },
}
