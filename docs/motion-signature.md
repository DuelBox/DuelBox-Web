# Motion and interaction signature (#2333)

**Status: SPEC — the durable, identity-independent half is written and enforced; the
expressive half waits on the brand identity (#2322), which is an owner decision.**

A motion signature is the small set of rules that make a product's movement feel like *one*
product: how fast things move, how they ease, what a press feels like, what motion means. Half
of that is mechanical and already true here; half of it is brand, and cannot be written until
someone decides what DuelBox's brand *is*.

## The dependency, stated plainly

#2322 (the brand identity) is **unmade**. Its own notes record that the two seat colours are
1.03:1 under deuteranopia and the sky is within an RGB delta of a reference app's blue — open
questions a person has to answer. A motion signature that committed to a feel — bouncy vs
crisp, playful vs restrained, a signature transition — would be inventing that identity by the
side door. So this document writes the part that holds regardless of the answer, and marks the
rest as **owner decisions** with the questions they need to answer.

## What is already fixed (identity-independent, and enforced)

These are not proposals; they are how the shell moves today, and tests hold them there.

| Rule | Value | Where |
|------|-------|-------|
| Three durations, and only three | `--db-duration-fast: 120ms`, `--db-duration: 200ms`, `--db-duration-slow: 380ms` | `tokens.css`; `motion.test.ts` fails any timed CSS not reaching for one |
| One easing curve | `--db-ease: cubic-bezier(0.2, 0.8, 0.2, 1)` — a gentle decelerate | `tokens.css`; `standardEase` is the same curve solved, for tweens |
| Reduced motion is a first-class state | the three durations collapse to `1ms`; informative motion becomes an instant state change, decorative motion is removed | `tokens.css`, `motion.test.ts`, `reduced-motion.spec.ts`, `reduced-motion-winnable.test.ts` |
| Motion never carries meaning alone | every animated state also has a non-motion signal (rule 7); the seat flip is a snap under reduced motion, not lost | `Canvas2DRenderer.setReducedMotion`, the greyscale harness |
| A press has a floor size, physically | gameplay controls scale to a millimetre floor by DPR (#1889) | `touch-target.ts` |
| Focus is a visible, two-colour ring | ≥3:1 on every background, both themes (#176) | `focus-ring.test.ts` |

**The signature principle behind them:** motion in DuelBox is *informative first*. A movement
either tells a player something (a turn changed hands, a round ended, focus moved) or it is
decorative and disposable. The reduced-motion lever is the proof: everything decorative can be
removed and nothing is lost, because nothing decorative was carrying meaning. Any expressive
motion the brand adds must keep that property.

## What waits on #2322 (owner decisions)

Each of these needs the brand answered before it can be written, and each names the question.

1. **The feel of the standard transition.** The curve is fixed but the *character* is not —
   does DuelBox overshoot a little (a playful settle) or land flat (a crisp, quick product)?
   → Decide the personality in #2322, then pick a signature curve (and whether a spring is ever
   used) to match.
2. **A signature entrance.** Is there one move that is *ours* — the way a card flips, a board
   settles, a result stamps in? → This is the "seam" motif's motion analogue and cannot be
   drawn before the seam is. Candidate once #2322 lands: the board's seat-flip as the hero
   gesture, since it already exists and is unique to the shared-screen idea.
3. **Interaction feedback weight.** How much does a press depress, a toggle travel, a tile lift
   on hover? → A tone decision (restrained vs bouncy) that follows the brand personality.
4. **Motion accent colour / trail identity.** If motion ever leaves a trail (a score bump, a
   win sweep), in what colour and shape? → Blocked on the palette decision in #2322; the seat
   palette work (#174) gives the colour-blind-safe pair to build on, but the brand accent is
   still unchosen.

## One table, both layers

The durations and the curve above are used by two motion systems that share no mechanism, and
until #72 they shared no numbers either. The shell moves in CSS: `--db-duration*`, `--db-ease`,
and the cascade as the reduced-motion lever. Games move through `Tween` on the fixed timestep,
inside a package that has no DOM — lint forbids `window` and `document` there — so a game
cannot read a custom property, cannot be handed one, and counts in seconds rather than
milliseconds because that is what the timestep counts in. Neither layer can adopt the other's
mechanism without giving up something it needs.

What they can share is the table, and the dependency decides which end holds it: the engine
cannot import the app, and the app already imports the engine. So `packages/engine/src/motion.ts`
is where the numbers are authored —

```
MOTION.durationFastSeconds  0.12   ↔  --db-duration-fast: 120ms
MOTION.durationSeconds      0.2    ↔  --db-duration:      200ms
MOTION.durationSlowSeconds  0.38   ↔  --db-duration-slow: 380ms
MOTION.ease  [0.2, 0.8, 0.2, 1]    ↔  --db-ease: cubic-bezier(0.2, 0.8, 0.2, 1)
```

— `standardEase` is that curve inverted and evaluated, so a tween and a transition ease
identically; `apps/web/src/styles/tokens.ts` restates the table in the spellings CSS wants; and
`tokens.test.ts` parses `tokens.css` and fails when either side has moved without the other. A
`Tween` given no duration now runs for `MOTION.durationSeconds` rather than the 0.25 s it used
to invent.

Reduced motion stays two levers, because the two layers answer it in different places. CSS
collapses the three durations to 1ms. A tween must not: its duration decides *how many steps* a
value takes to arrive, and a duration that varies with a device preference is two devices
stepping the same match differently — so `Tween.valueFor` answers with the destination instead,
changing what is drawn and not what is stepped. `motionDuration(seconds, reducedMotion)` gives
the CSS collapse to the JS layer for the one case where it is safe: motion that belongs to a
single device and that nothing else is watching — a shell overlay, a host panel — where there
is no second device to disagree with. It returns 0.001 s, which is the same 1ms.

## How to finish this

When #2322 is decided: fill the four sections above with concrete values, add any new duration
or curve token to `MOTION` and to `tokens.css` (and to the reduced-motion block, or
`motion.test.ts` fails it; and to `tokens.test.ts`, or the two copies are unheld),
and — if a signature entrance is added — give it a reduced-motion counterpart that is an
instant state change, so the "informative first" property above survives it. Until then, the
enforced half is the whole of the motion signature that can honestly exist.
