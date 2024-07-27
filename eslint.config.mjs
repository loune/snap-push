import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';

const eslintTsConfig = tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        // tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'class-methods-use-this': 'off',
      'no-param-reassign': 'off',
      'lines-between-class-members': 'off',
      'no-restricted-syntax': 'off',
      '@typescript-eslint/explicit-member-accessibility': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'react/prop-types': 'off',

      'no-useless-constructor': 'off',
    },
  }
);

export default [
  ...eslintTsConfig,
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],

    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
];
