import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default [
  {
    ignores: [
      'node_modules/',
      'public/', // Output directory
      '.vercel/', // Vercel output
      'dist/', // Common build output directory
      '*.config.js', // Ignore this eslint.config.js and prettier.config.js
      '*.config.cjs',
      '*.config.mjs',
    ],
  },
  {
    languageOptions: {
      ecmaVersion: 2022, // Or latest
      sourceType: 'module',
      globals: {
        ...globals.node, // Node.js global variables
        ...globals.es2021, // ES2021 global variables
      },
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json', // Path to your tsconfig.json
        ecmaFeatures: {
          jsx: false, // Adjust if you use JSX
        },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      // 'prettier' plugin is implicitly added by pluginPrettierRecommended
    },
    rules: {
      // ESLint recommended rules (subset)
      'no-unused-vars': 'off', // Disabled in favor of @typescript-eslint/no-unused-vars
      'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
      // Add other ESLint core rules here if needed

      // TypeScript ESLint recommended rules
      ...tseslint.configs.recommended.rules,
      // You can override or add more @typescript-eslint rules here
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn', // Good practice to avoid 'any'
    },
  },
  pluginPrettierRecommended, // Enables eslint-plugin-prettier and displays prettier errors as ESLint errors. Make sure this is last.
];
