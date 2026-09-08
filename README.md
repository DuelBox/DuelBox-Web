# DuelBox

A browser collection of two-player mini-games played by two people on one device, in one
tab. No accounts, and nothing to install. Once a page has loaded, playing it needs no network
at all — the simulation, the bots and the physics are all on your device, and
`e2e/offline.spec.ts` blocks every request after load and plays a bot match through to
prove it.

Coming back is now the same story, with one condition that is stated precisely here rather
than rounded up. A service worker saves the site's shell on the first visit and saves each
game on the device that played it, so **a game this device has opened before opens and plays
with no connection at all**, and its second play costs zero network requests (#192, #2445) —
both measured by that same spec, which cuts the network at the browser and opens the game in
a new tab. **A game this device has never opened is not saved** unless the whole collection
was downloaded from Settings (#196) — one press, the size stated first, cancellable, and
picking up where it stopped — and a game that is not here says so on a page of the site's own
rather than a browser error page (#193). The catalogue marks which is which, in words. `docs/pwa.md` is the whole of it: what is cached, what deliberately is not, how an
update is offered rather than imposed, and which of those claims is verified on which browser
engine.

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
