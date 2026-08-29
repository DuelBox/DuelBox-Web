import { describe, expect, it } from 'vitest';
import { CONTROLS, MANIFESTS } from './controls.js';
import { PLAYABLE } from './registry.js';

/**
 * The landing page promises a game's controls; the registry decides which games are
 * playable. If the two drift, a playable game's page silently loses its controls — the
 * kind of gap nobody notices because nothing errors.
 */
describe('the controls map', () => {
  it('covers every playable game', () => {
    const missing = PLAYABLE.filter((slug) => !CONTROLS.has(slug));
    expect(missing, `add these to controls.ts: ${missing.join(', ')}`).toEqual([]);
  });

  it('names no game that is not playable', () => {
    const extra = [...CONTROLS.keys()].filter((slug) => !PLAYABLE.includes(slug));
    expect(extra, `these are not in the registry: ${extra.join(', ')}`).toEqual([]);
  });

  it('gives every game something to say about both input families', () => {
    for (const [slug, controls] of CONTROLS) {
      expect(controls.keyboard.length, `${slug} keyboard`).toBeGreaterThan(3);
      // The pointer line may be empty for an archetype with no pointer idiom, but the
      // field must exist rather than being undefined.
      expect(typeof controls.pointer, `${slug} pointer`).toBe('string');
    }
  });
});

/**
 * The two keyboard halves belong to two different people, in every game.
 *
 * `DEFAULT_BINDINGS` binds W A S D and Space to seat one and the arrow keys and Enter to
 * seat two, strictly disjointly, and nothing anywhere remaps them — `setBoardSeat` moves
 * *pointer* ownership when a turn changes and touches the keyboard not at all. So "W A S D
 * **or** the arrow keys" is false whatever the archetype. It is merely false in two
 * different ways: in a simultaneous game the other half moves your opponent, and in a
 * turn-based one it does nothing at all until it is that player's turn.
 *
 * Eighteen manifests said it. The first sweep only fixed the five real-time ones, on the
 * reasoning that both halves drive whoever is to move in a turn game — which a browser
 * disproved: holding the right arrow in Tic Tac Toe on seat one's turn moves nothing.
 */
describe('keyboard controls', () => {
  /**
   * What it means to name a seat.
   *
   * The guard below exists to catch a manifest that never says whose half a key belongs
   * to. It used to accept the bare word `left` or `right`, and those two words appear in
   * almost every steering line in the catalog — "steer left and right", "the left and
   * right arrows", "change lane on the left road". So the check passed on a word that was
   * describing *movement*, and a manifest reading "arrow keys and A/D steer left and
   * right" — which names no seat at all — satisfied the very guard written to catch it.
   *
   * A direction word now only counts when it qualifies something a seat *owns*: "the left
   * player", "the near paddle", "the player on the right". The words a direction may not
   * qualify are listed below — they are the ones that turn it back into a movement or a
   * key ("left and right", "left arrow", "near key") rather than an owner. "seat" and
   * "player one/two" still stand alone, because neither can mean anything but a seat.
   */
  const DIRECTION = 'left|right|near|far|top|bottom';
  const NOT_AN_OWNER = 'and|or|arrow|arrows|key|keys|then|to|of|for';
  const NAMES_A_SEAT = new RegExp(
    [
      // Named outright: "Player one", "player 2".
      String.raw`\bplayers?\s+(?:one|two|1|2)\b`,
      // "seat" needs no qualifier: "seat two", "the near seat", "for the far seat".
      String.raw`\bseats?\b`,
      // A direction on something a seat owns: "the left roller", "your near paddle",
      // "the far one". The lookahead is what rejects "the left and right arrows".
      String.raw`\b(?:the|your|their)\s+(?:${DIRECTION})[-\s]+(?!(?:${NOT_AN_OWNER})\b)[a-z]+\b`,
      // The other word order: "the player on the left", "the half on the far side".
      String.raw`\b(?:player|side|half)\b[^.;]{0,24}?\bon\s+the\s+(?:${DIRECTION})\b`,
    ].join('|'),
    'i',
  );

  it("never offers the two key halves as one player's choice", () => {
    for (const manifest of MANIFESTS) {
      const { keyboard } = manifest.controls;
      if (!/arrow/i.test(keyboard)) continue;
      expect(
        keyboard,
        `${manifest.id} presents both key halves as one player's choice`,
      ).not.toMatch(/\bor\b[^,:]*arrow/i);
      expect(
        keyboard,
        `${manifest.id} does not say which half belongs to which player`,
      ).toMatch(NAMES_A_SEAT);
    }
  });

  it("never tells one seat to use the other seat's keys", () => {
    // Pop It said "Arrow keys to pick a bubble" and nothing else, which is simply seat
    // two's keys presented as everybody's.
    for (const manifest of MANIFESTS) {
      const { keyboard } = manifest.controls;
      const mentionsArrows = /arrow/i.test(keyboard);
      const mentionsWasd = /w a s d|\ba and d\b|left and right/i.test(keyboard);
      if (mentionsArrows && !mentionsWasd) {
        expect.fail(`${manifest.id} names only seat two's keys: "${keyboard}"`);
      }
    }
  });

  it('covers every game, or it is guarding nothing', () => {
    expect(MANIFESTS.length).toBeGreaterThan(20);
  });
});
