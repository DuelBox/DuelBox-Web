## What this changes, and why

<!-- The reasoning, not the diff. If a number changed, say what you measured and over how
     large a sample. -->

## The gate

CI runs these six in this order. Tick what you ran locally.

- [ ] `pnpm format:check` — first because it is cheapest and it is the one that gets skipped
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build` (runs the manifest validator, the zero-cost and secret guards, and `pnpm size`)
- [ ] `pnpm e2e`

## Definition of done

Delete any line that genuinely does not apply, rather than leaving it unticked.

- [ ] Both seats verified independently
- [ ] Both presentations verified — shared-screen and single-seat
- [ ] Correct from 320px to 4K, in both orientations
- [ ] Works on iOS Safari and Chrome Android
- [ ] Keyboard accessible; both seats' keys named in the manifest
- [ ] Reduced motion respected
- [ ] Playable in greyscale — no player-owned element differs by colour alone (rule 7)
- [ ] Under the size budget; the shell did not grow
- [ ] Every new asset has an `assets.license.json` entry
- [ ] No `Math.random` in simulation code; no per-frame allocation in `update()`
- [ ] No simulation value expressed in pixels; no branch on device type

## Issues

<!-- Closes #… — one keyword per issue; GitHub does not parse "Closes #1, #2". -->
