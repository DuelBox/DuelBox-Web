import type { StorybookConfig } from '@storybook/nextjs';
import { join } from 'node:path';

/**
 * Storybook for the shell components (#75).
 *
 * The issue asks for a Storybook for "the UI package", which does not exist — there is no
 * `packages/ui`; the shared components live in `apps/web/src/components`. So the stories point
 * there, and the framework is `@storybook/nextjs` because that is the app they belong to: it
 * gives the stories the same `@/*` path alias, the same CSS-module handling, and the same
 * `next/*` shims the components import, so a component renders in Storybook the way it renders
 * in the app rather than in an approximation of it.
 *
 * Stories live in `.storybook/stories`, deliberately **not** beside the components. Co-located
 * `*.stories.tsx` under `apps/web/src` would be compiled by `next build` (a static export that
 * globs every `.tsx` under the app) and by the app typecheck, both of which would fail on the
 * `@storybook/*` imports until Storybook is installed — and this repository's gates are green
 * and stay that way. Keeping the stories out of the app tree keeps them out of every gate that
 * does not know about Storybook; `docs/storybook.md` records why, and how to activate it.
 */

const webSrc = join(__dirname, '..', 'apps', 'web', 'src');

const config: StorybookConfig = {
  stories: ['./stories/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-essentials', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/nextjs',
    options: {},
  },
  // The public assets — the icon SVGs and the manifest icons (#73) — served at the root the
  // components expect.
  staticDirs: [join(__dirname, '..', 'apps', 'web', 'public')],
  webpackFinal(base) {
    base.resolve ??= {};
    base.resolve.alias = {
      ...base.resolve.alias,
      // The same `@/*` alias `apps/web/tsconfig.json` gives the app, so a story can import a
      // component by the path the app uses.
      '@': webSrc,
    };
    return base;
  },
  typescript: {
    // The app already typechecks the components in `pnpm typecheck`; Storybook re-checking
    // them on every start buys nothing and slows the loop.
    check: false,
  },
};

export default config;
