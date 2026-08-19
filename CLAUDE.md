# DuelBox

A browser collection of two-player mini-games played by two people on one device
in one tab. Original implementations of game genres that are free to reimplement.
No accounts. Offline-capable.

Read `docs/reference-analysis.md` before touching engine, input, or SDK code — it
records what the reference app actually does and why our architecture is shaped
the way it is.

## Non-negotiable rules

1. **Original assets only.** Never copy art, audio, code, UI layouts, or names from
   another product. Mechanics and rules are fine — they are not protected.
   Everything else is not.
2. **Never decompile, unpack, or extract from any APK.** Reference apps are
   researched by playing them and writing down what is observed. If you find
   yourself reaching for apktool, jadx, or unzip on an APK, stop and say so.
3. Every asset needs an `assets.license.json` entry. CI enforces it.
4. All simulation runs on the fixed timestep. Never `Math.random()` in gameplay —
   seeded RNG only. Lint enforces it.
5. No per-frame allocations in engine or game `update()`.
6. Bots never get information, speed, or physics a human cannot get.
7. Colour is never the only signal. Every player-owned element also differs by
   shape, pattern, or label.
8. Nothing merges without tests, and nothing merges over the size budget.

## The two ideas the whole product rests on

**Seats.** Two people sit on opposite sides of one device. A touch belongs to the
seat it *started* in and keeps that ownership even when the finger crosses the
midline. In turn-based games the play area rotates 180° and recolours to the active
player so each person reads it upright. Both live in the engine, never in a game.

**One shell, many games.** Games supply a simulation and a win condition. Countdown,
HUD, pause, result, rematch, seat rotation, difficulty, and tournament reporting all
come from the SDK. A bespoke version of any of those inside a game package is a bug.

## Layout

```
apps/web            site shell, routing, landing, catalog, game host
packages/engine     loop, renderer, physics, input, seats, audio
packages/game-sdk   the Game contract every game implements
packages/games/*    one folder per game, one chunk per game
packages/ui         shared components
docs/               research, design docs, ADRs
```

## Commands

`pnpm dev` · `pnpm test` · `pnpm lint` · `pnpm typecheck` · `pnpm build` · `pnpm size`

## Definition of done

Tests pass · types clean · lint clean · under size budget · both seats verified ·
works on iOS Safari and Chrome Android · keyboard accessible · reduced-motion
respected · playable in greyscale · assets licensed
