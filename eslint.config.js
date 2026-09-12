import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import noUntranslatedText from './scripts/eslint-rules/no-untranslated-text.mjs';

/**
 * Every `.tsx` under the web app is held to `duelbox/no-untranslated-text` (#219, #220).
 *
 * The rule reports bare text in JSX and a literal in the seven user-facing attributes, so a
 * sentence added to any component without `t()` / `<T>` fails lint. Until 12 September 2026 it
 * was a ratchet, `I18N_CLEAN`, an explicit list a file joined in the commit that converted it;
 * #220 converted every file and the list became this glob, at which point the ratchet became
 * the rule. What stays exempt, each with its reason in `docs/i18n.md` under "deliberately not
 * translated": anything inside `<noscript>` (the rule skips the subtree itself), and the handful
 * of literals carrying an `eslint-disable-next-line duelbox/no-untranslated-text -- <reason>`
 * comment — the skip link and the framed notice in `app/layout.tsx`, whose `<T>` would be
 * serialised into all 108 play payloads, and the two lines of `play/[slug]/loading.tsx`, which
 * a test holds to importing nothing. Game names, `metadata` exports and key caps are not
 * literals the rule can see and are exempt by design rather than by comment. What the rule
 * cannot see — a string reaching JSX through a variable — is what `e2e/pseudo-sweep.spec.ts`
 * walks the pseudo-locale for.
 */
const I18N_FILES = ['apps/web/src/**/*.tsx'];

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
      // Storybook (#75) is scaffolded but not installed here, so its config and stories import
      // `@storybook/*` — packages this repository does not yet depend on. They live outside
      // the app tree and outside every gate's tsconfig; ignoring them keeps `eslint .` from
      // failing on the unresolved imports until Storybook is added. See docs/storybook.md.
      '.storybook/**',
      '**/*.stories.tsx',
      '**/storybook-static/**',
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
    // The Rules of Hooks, enforced. `apps/web` is the only React in the repo — the engine,
    // the SDK and the games are all framework-free — so the plugin is scoped to it rather
    // than run over 108 packages that contain no components.
    //
    // It lives in the *root* config on purpose. `apps/web/eslint.config.js` is empty so that
    // `next build` does not open a second, differently-configured pass over these files, and
    // that arrangement is worth keeping. But "the root already covers them" was only true of
    // type-aware TypeScript rules, and type-awareness is not what catches a hook bug: a
    // dependency array missing a value it closes over type-checks perfectly (#2482). A
    // stale-closure bug in PlaySurface.tsx was caught by hand before this rule existed, and
    // the comment left behind at the time said the rule would have caught it.
    //
    // Both are errors. `exhaustive-deps` ships as a warning, and a warning here is a rule
    // that does not run: `pnpm lint` exits 0 with warnings on screen, so CI stays green and
    // the finding scrolls past.
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // The i18n rule: see `I18N_FILES` above.
    files: I18N_FILES,
    plugins: { duelbox: { rules: { 'no-untranslated-text': noUntranslatedText } } },
    rules: { 'duelbox/no-untranslated-text': 'error' },
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
    // ...except the half of `responsive-matrix.mjs` that is not Node. The bodies it hands to
    // `page.evaluate` are serialised and run inside the page, where `document`, `window` and
    // `getComputedStyle` are the ambient globals. `e2e/responsive.ts` states the same
    // measurements and escapes this rule only by being TypeScript, where `no-undef` is off and
    // the DOM lib supplies the names; the matrix is a Node script and cannot import TypeScript,
    // so it says them again in plain JavaScript and needs the globals named here. The Node
    // globals above still apply — the file is a Node script either side of those callbacks.
    files: ['scripts/responsive-matrix.mjs'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  prettier,
);
