# Visual counterparts for every audio cue (#180)

**Status: PARTIAL — infrastructure complete, live per-game verification blocked on the audio
bus.**

WCAG 1.4.1 (and the product's own rule 7) forbids carrying information by sound alone: every
audio cue must have something a player can *see*. This records where that stands.

## What is done

- **The vocabulary and the mapping.** `packages/engine/src/sound-events.ts` is the closed set
  of cues, split into shell-owned and game-owned. `apps/web/src/lib/sound-visuals.ts` maps
  **every** cue to its visual counterpart, and it is typed `Record<SoundEvent, …>`, so the
  compiler fails the build if a cue has no visual or a visual names a cue that does not exist.
- **The shell counterparts are drawn and pinned.** Each shell cue's counterpart names a source
  file and a marker string that must appear in it (`sound-visuals.test.ts`), so a counterpart
  cannot quietly stop being drawn — the countdown, the pause panel, the round and match
  panels, the winner's glyph.
- **The per-game audit harness exists.** `sound-visuals.test.ts` walks **every game package on
  disk** and fails if any game emits a cue that is undeclared, that the shell owns, or that has
  no visual counterpart. This is the machine form of "every game is playable with sound off":
  a game is playable with sound off exactly when nothing it signals is sound-only, i.e. every
  cue it emits also has a visual — which the harness checks against what the games actually
  emit, not against a hand-kept list (the flaw that made #2519 worthless).

## What is not done, and why

**No game emits audio, because there is no audio bus.** `GameContext` on this base has no
channel a game could emit a cue through (#169/#170 — no sound files, no bus). So today the
per-game guarantee is *vacuously* true: nothing is carried by sound because nothing is sound.
The harness above is deliberately older than the thing it checks, so the first cue ever wired
meets it rather than being reviewed by hand — but until that cue exists, there is nothing to
verify against real audio.

**Full per-game verification therefore waits on the audio bus.** When it lands:

1. Each game wires its cues through the bus.
2. The harness starts seeing real emissions and enforces a visual for each — automatically,
   with no new test.
3. A per-game QA pass (each game's `SPEC.md`) confirms by hand that the *drawn* counterpart is
   actually perceptible during play, which a static scan cannot judge.

Until then this item is honestly **partial**: the mapping, the type-level totality, and the
per-game emission scan are complete and guarding; the end-to-end "played it with the sound
off and lost nothing" check cannot be performed on a product that makes no sound.
