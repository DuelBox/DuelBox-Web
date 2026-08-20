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
8. **No simulation value is ever expressed in pixels.** Games simulate in fixed
   logical units; only the render layer knows the device. A phone and a laptop
   must step the identical match, or cross-device play is impossible.
9. **Neither player may ever see more of the play area than the other.** In
   remote play both devices letterbox to a negotiated shared viewport. Surplus
   screen space holds chrome, never extra field of view.
10. **No game code branches on device type.** One build serves phone, tablet,
    laptop, and desktop; differences are handled by presentation and layout.
11. Nothing merges without tests, and nothing merges over the size budget.

## The two ideas the whole product rests on

**Seats.** Two people sit on opposite sides of one device. A touch belongs to the
seat it *started* in and keeps that ownership even when the finger crosses the
midline. In turn-based games the play area rotates 180° and recolours to the active
player so each person reads it upright. Both live in the engine, never in a game.

**One shell, many games.** Games supply a simulation and a win condition. Countdown,
HUD, pause, result, rematch, seat rotation, difficulty, and tournament reporting all
come from the SDK. A bespoke version of any of those inside a game package is a bug.

## Two presentations, one game

Every game renders two ways, and the SDK decides which — the game never does:

- **Shared-screen** — two seats on one device. The play area splits or rotates so
  both people can read it, exactly as the reference app does.
- **Single-seat** — one player alone on their own device, playing someone else
  remotely. The local seat owns the whole viewport, always upright, with
  full-device controls.

Rules, scoring, and simulation are byte-identical across both. Only placement,
rotation, and control mapping change.

## Fairness across devices

A thumb, a mouse, and a trackpad are not equivalent instruments, and a laptop
screen is not a phone screen. Three rules keep cross-device matches honest:
the shared logical viewport (rule 9), a common precision envelope so no input
family can aim finer than another, and reaction outcomes resolved on source
timestamps rather than packet arrival. A game that cannot be made fair
cross-device declares itself same-class-only rather than shipping unfair.

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

The gate CI runs, in order — run all of it before claiming a change is done:

```
pnpm format:check && pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e
```

`format:check` is first because it is cheapest and it is the one that gets skipped:
CI failed on it for every commit until 20 August 2026 while local runs of the other
five passed, so the repository looked green and was not. `pnpm build` runs
`pnpm size` at the end, so the size budget is checked as part of it.

`pnpm e2e` runs Chromium and real WebKit. `pnpm e2e:all` adds Firefox and is what
the nightly workflow runs — the suite passes on Firefox and has since it was first
tried, so paying for a third engine on every push buys nothing. If a nightly ever
fails, move it back to every push.

**CI is over its own budget.** The verify job takes about 14 minutes against the
8 minutes issue #2459 names. Most of it is `pnpm e2e` running the same tests across
four projects. Worth fixing; not fixed.

## Definition of done

Tests pass · types clean · lint clean · under size budget · both seats verified ·
both presentations verified · correct from 320px to 4K in both orientations ·
cross-device match verified against the harness · works on iOS Safari and Chrome
Android · keyboard accessible · reduced-motion respected · playable in greyscale ·
assets licensed
