# Reduced motion: coverage across the shell and the games (#175)

`prefers-reduced-motion` is honoured everywhere, and this records how — one mechanism per
layer, and the guard that proves each one covers what it claims.

## The shell

The lever is the cascade, and it is a single one. `styles/tokens.css` collapses
`--db-duration-fast`, `--db-duration` and `--db-duration-slow` to `1ms` under
`prefers-reduced-motion: reduce`, and every transition and animation in the shell is timed
by one of those three tokens. Nothing needs a JavaScript kill switch.

- **Guard:** `styles/motion.test.ts` reads every stylesheet and fails on any timed
  declaration that is not reaching for a collapsible token or already switched off. It is
  static, so it proves the lever is wired to everything; it cannot prove the lever moves.
- **Guard:** `e2e/reduced-motion.spec.ts` sets the preference in a real browser and asserts
  the tokens actually collapse (and do not when the preference is off, so the test means
  something).

## The games

A game never reads the preference itself — that would be a game branching on the device,
which the engine's `no-restricted-globals` lint forbids (`matchMedia` is banned under
`packages/`). The preference is read once by the shell and handed down through two channels,
and **both are render-only**:

1. **The seat flip.** `Canvas2DRenderer.setReducedMotion` snaps the board's half-turn to a
   whole turn instead of animating it. This reaches **all forty-five flip-owning games** for
   free, because the flip lives in the engine, not in any game.
2. **`GameContext.reducedMotion`.** Handed to a game as a *drawing* hint — for a trail, a
   particle, a shake — read as `context.reducedMotion ?? false`. It is passed to `init`, and
   `GameHost` reads the live value with `prefersReducedMotion()` there so the very first
   match honours it rather than the one after.

The rule that makes this safe is that neither channel may reach the fixed-step simulation.
A game that dimmed a trail under reduced motion is fine; a game that changed *what happened*
would have made motion-off a different, possibly unwinnable, match.

- **Guard:** `apps/web/src/data/reduced-motion-winnable.test.ts` runs **every one of the 107
  games** twice, bot against bot from the same seed, once with `reducedMotion` off and once
  on, and requires the two to step the identical match — the same score after every step and
  the same winner. Identical trajectories prove the flag never reached the simulation, which
  is exactly "gameplay remains winnable with motion disabled", verified per game rather than
  argued. A game that read the flag in `update()` fails this the moment the two runs diverge.

## What is not covered here, and why

The **feel** of a specific game's reduced-motion drawing — whether a particular shake or
flash is tasteful when stilled — is a per-game QA judgement recorded in that game's
`SPEC.md`, not something a harness can assert. What the harness guarantees is the load-
bearing half: that stilling the motion never costs a player the match.
