# Storybook for the shell components (#75)

**Status: SCAFFOLDED, not installed — the config, the token decorator, the stories and the
scripts are in place; activating it is one `pnpm add` away and is a deliberate, separate step.**

## What is here

- **`.storybook/main.ts`** — a `@storybook/nextjs` config that points at
  `.storybook/stories`, wires the app's `@/*` path alias and `apps/web/public` static dir, and
  turns off Storybook's own typecheck (the app's `pnpm typecheck` already covers the
  components).
- **`.storybook/preview.tsx`** — the **token-driven theme decorator** the issue asks for. It
  imports the real `tokens.css` and `globals.css`, and two toolbar globals set `data-theme` and
  `data-seat-palette` on the story wrapper — the *same attributes* the app sets at runtime — so
  the identical cascade themes every story. Light/dark and standard/colour-blind are a toolbar
  flip. It also mounts `IconSprite` so `<Icon>` stories resolve.
- **`.storybook/stories/`** — `Icon.stories.tsx` (a story per state: decorative, labelled, and
  the whole gallery) and `Tokens.stories.tsx` (palette swatches that prove the decorator
  re-themes). These are the pattern; add one `*.stories.tsx` per shared component beside them.
- **`package.json`** scripts — `pnpm storybook` (dev) and `pnpm build-storybook` (static build).

## Why it targets `apps/web/src/components`, not a UI package

The issue says "the UI package", but there is **no `packages/ui`** — the shared components live
in `apps/web/src/components`. So the stories target those, through `@storybook/nextjs`, which
gives them the same aliases, CSS-module handling and `next/*` shims the app uses.

## Why the stories live in `.storybook/stories`, not beside the components

The app is a **static export**, and `next build` globs every `.tsx` under `apps/web/src`. A
`*.stories.tsx` co-located there would be compiled by the build — and by `pnpm typecheck` — and
both would fail on the `@storybook/*` imports until Storybook is installed. The repository's
gates are green; keeping the stories out of the app tree keeps them out of every gate that does
not know about Storybook. `eslint.config.js` ignores `.storybook/**` and `**/*.stories.tsx` for
the same reason (they are not in any gate's `tsconfig` program).

## The blocker, honestly

Storybook is **not installed in this environment** and its build is therefore **unverified**.
Two reasons, both real:

1. **The packages are not available offline.** This worktree installs from a shared pnpm store
   that does not contain `storybook`, `@storybook/nextjs` or the addons, and the environment has
   no reliable network to fetch them. Adding them to `package.json` without a matching lockfile
   update would fail CI's frozen install, so `package.json`'s **dependencies are deliberately
   left unchanged** — only the run scripts are added.
2. **Static-export compatibility is untested.** `@storybook/nextjs` supports the app router, but
   this app sets `output: 'export'`, `basePath`, a strict CSP and self-hosted fonts. None of
   that should trouble Storybook (it runs its own webpack, not `next build`), but it has not
   been run here to confirm.

## Activating it

```bash
pnpm add -D storybook @storybook/nextjs @storybook/react \
  @storybook/addon-essentials @storybook/addon-a11y
pnpm storybook        # dev server on :6006
pnpm build-storybook  # static build in storybook-static/
```

If the static-export toolchain turns out to fight `@storybook/nextjs`, the fallback is
`@storybook/react-vite` with the same `@/*` alias and CSS imports — the decorator and stories
are framework-agnostic and would move across unchanged. Once it runs, add a story per shared
component (`SoundToggle`, `GameCard`, `MatchOverlay` states, `SettingsPanel` sub-controls,
`TournamentTrack`), and consider adding `pnpm build-storybook` to a CI job — but only after a
first green run, per this repository's rule that a guard nobody has watched fail is a guard
nobody has.
