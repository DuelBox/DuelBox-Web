# DuelBox

A browser collection of two-player mini-games played by two people on one device, in one
tab. No accounts, no install, offline-capable.

## Layout

```
apps/web            site shell, routing, landing, catalog, game host
packages/engine     loop, renderer, physics, input, seats, audio
packages/game-sdk   the Game contract every game implements
packages/games/*    one folder per game, one lazily-loaded chunk per game
data/               the catalog, as YAML, and its generated form
docs/               research, design docs, ADRs
e2e/                Playwright specs, run against the built static site
scripts/            catalog generation, scaffolding, and the build-time guards
```

## Getting started

```bash
pnpm install
pnpm dev
```

## The gate

Run all of it before claiming a change is done. CI runs the same six, in this order.

```bash
pnpm format:check && pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e
```

`pnpm build` runs the manifest validator, the zero-cost guard, the secret scan, the asset
licence check and the size budget. `pnpm test:coverage` adds a 70% floor.

## Adding a game

```bash
pnpm create-game <id>                    # scaffolds packages/games/<id>
node scripts/register-game.mjs <id>      # wires it into the four places the shell reads
```

Then write `rules.ts` (the simulation, pure), `game.ts` (input and drawing), and both test
files. `packages/games/ping-pong` is the worked example.

`CLAUDE.md` has the eleven rules that are not negotiable — original assets, seeded RNG,
logical units rather than pixels, and the rest. Read it before touching engine, input or
SDK code, along with `docs/reference-analysis.md`.
