import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      // The dev server's own output directory, kept separate so a build cannot clobber it.
      '**/.next-dev/**',
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
      // No simulation value may be expressed in pixels and no game may branch on the
      // device (CLAUDE.md rules 8 and 10). Both held by discipline alone until now — an
      // audit confirmed nothing in these packages touched the device, but nothing stopped
      // the next commit from doing so. The engine's `browserClock` is the one legitimate
      // reader of wall time and lives behind an injectable seam in loop.ts.
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Simulation time comes from the fixed loop, not wall time.' },
        {
          name: 'window',
          message: 'Games and the engine never read the device. The host passes logical units in.',
        },
        {
          name: 'document',
          message:
            'The DOM belongs to the host. A game receives input and a renderer, nothing else.',
        },
        {
          name: 'devicePixelRatio',
          message: "Device pixels are the render layer's business. Simulate in logical units.",
        },
        {
          name: 'screen',
          message:
            'Screen size must not reach the simulation, or two devices step different matches.',
        },
        {
          name: 'navigator',
          message: 'Branching on the device breaks one-build-serves-every-device.',
        },
        {
          name: 'requestAnimationFrame',
          message: 'Frame timing comes from the fixed loop, which the host drives.',
        },
        {
          name: 'performance',
          message: 'Wall time breaks determinism. Use the fixed delta the loop hands you.',
        },
        {
          name: 'matchMedia',
          message: 'Device preferences are read by the host and applied to presentation only.',
        },
      ],
    },
  },
  {
    // The one legitimate reader of wall time: the clock the host injects into the loop.
    files: ['packages/engine/src/loop.ts'],
    rules: { 'no-restricted-globals': 'off' },
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
