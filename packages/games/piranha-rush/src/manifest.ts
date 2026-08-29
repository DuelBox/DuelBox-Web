import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'piranha-rush',
  name: 'Piranha Rush',
  category: 'Party',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  /**
   * Advertising, and for once also a **proved ceiling**.
   *
   * `roundSeconds` ends nothing anywhere in this repository — it is the "about 1 min" on
   * the catalogue card. What makes this one honest is that the shoal's closed-form
   * termination bound, `terminationBoundSeconds`, is 59.82 s at 60 Hz and 59.87 s at 15 Hz,
   * so no match can outlast the number printed on the card whatever anybody does.
   * `rules.test.ts` asserts that ordering at four step rates. Two `easy` bots average
   * 15.1 s and two `hard` bots 18.8 s.
   */
  roundSeconds: 60,
  controls: {
    // Neither half is a fallback for the other: seat one has W A S D and seat two has the
    // arrows, always, and pressing the wrong half moves the person opposite.
    keyboard: 'Seat one swims with W A S D, seat two with the arrow keys. Eight directions.',
    // The sign of the gap, never the position: see `game.ts`, `#read`. A finger anywhere in
    // your own half steers; resting it on your own swimmer is how you stop.
    pointer: 'Touch anywhere in your own half and your swimmer heads for your finger.',
  },
  tags: ['chase', 'reflex', 'dodge'],
  // Fair cross-device. `docs/input-parity.md` rules `rt-split` fair, and this game asks
  // less of an instrument than the archetype allows: the only quantity either family
  // produces is the sign of a gap on each axis, so the nine headings are exactly the
  // keyboard's own vocabulary and a pointer cannot name a tenth. SPEC.md carries the
  // argument and the latency arithmetic behind it.
  sameInputClassOnly: false,
});
