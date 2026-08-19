import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.generated.ts',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: ['./tsconfig.lint.json'], tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Gameplay randomness must come from the seeded RNG. Math.random breaks replays,
    // deterministic tests, and any future lockstep netcode - so it fails the build
    // rather than relying on a reviewer noticing it.
    files: ['packages/engine/**/*.ts', 'packages/game-sdk/**/*.ts', 'packages/games/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Use the seeded Rng from @duelbox/engine. Math.random breaks determinism, replays and lockstep.',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Simulation time comes from the fixed loop, not wall time.' },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Build scripts, config files and e2e specs run in Node, not the browser.
    files: ['scripts/**', 'e2e/**', '*.config.ts', '*.config.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  prettier,
);
