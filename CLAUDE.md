# DuelBox

Browser-based collection of two-player mini-games playable by two people
on one device in one tab. Original implementations of public-domain game
genres. No accounts required. Offline-capable.

## Non-negotiable rules

1. **Original assets only.** Never copy art, audio, code, UI layouts, or
   names from any other product. Mechanics and rules are fine — they are
   not protected. Anything else is not.
2. **Never decompile, unpack, or extract assets from any APK.** Reference
   apps are researched by playing them and writing down what you observe.
3. Every asset added needs an `assets.license.json` entry. CI enforces it.
4. All simulation runs on the fixed timestep. Never `Math.random()` in
   gameplay — seeded RNG only.
5. No per-frame allocations in engine or game `update()`.
6. AI opponents never get information, speed, or physics a human cannot get.
7. Nothing merges without tests, and nothing merges that breaks the size budget.

## Layout

apps/web            site shell, routing, landing page
packages/engine     loop, renderer, physics, input, audio
packages/game-sdk   the Game contract every game implements
packages/games/*    one folder per game
packages/ui         shared components
docs/               design docs and ADRs

## Commands

pnpm dev · pnpm test · pnpm lint · pnpm typecheck · pnpm build · pnpm size

## Definition of done

Tests pass · types clean · lint clean · under size budget ·
works on iOS Safari and Chrome Android · keyboard accessible ·
reduced-motion respected · assets licensed
