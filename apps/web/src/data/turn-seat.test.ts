import { describe, expect, it } from 'vitest';
import { LOADERS_FOR_TEST } from './registry';

/**
 * Every turn-based game must tell the shell whose turn it is.
 *
 * `GameHost` decides a game is turn-based by the *presence* of `getActiveSeat` — and only
 * then does it hand the whole board to the active seat and map both keyboard halves onto
 * them. A `turn-*` game without it is treated as real-time: the arrow keys drive the
 * player who is not playing, and half the device is dead to a finger.
 *
 * Nothing catches that in a unit test of the game itself, because the game is correct in
 * isolation — the contract it breaks lives in the shell. Shut the Box shipped this way and
 * it took loading the page to notice, which is exactly the sort of thing worth spending a
 * test on. The scaffold now generates the method for `turn-*` archetypes; this is the
 * check that it stayed.
 */
describe('turn-based games', () => {
  it('all report whose turn it is', async () => {
    const missing: string[] = [];
    let turnBased = 0;

    for (const [slug, load] of Object.entries(LOADERS_FOR_TEST)) {
      const loaded = await load();
      if (!loaded.manifest.archetype.startsWith('turn-')) continue;
      turnBased += 1;
      const game = loaded.create();
      if (typeof game.getActiveSeat !== 'function') missing.push(slug);
    }

    expect(
      turnBased,
      'this test found no turn-based games at all, so it is guarding nothing',
    ).toBeGreaterThan(5);
    expect(missing, `these are turn-based but never say whose turn it is: ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('never claims a real-time game has turns', async () => {
    // The other direction matters: a real-time game that reported an active seat would
    // switch the shell into shared-board mode and take one seat's pointer zone away.
    //
    // Checked on the **value**, not on whether the method exists. That distinction is
    // newer than this test: the host used to decide from the method's presence alone, so
    // having it at all meant "turn-based". Since Sea Battle it reads the live value, and
    // the contract has always documented null as "no turns right now" — which is now how
    // a simultaneous game with a `getActiveSeat` says so. Snake Clash is one.
    const wrong: string[] = [];
    for (const [slug, load] of Object.entries(LOADERS_FOR_TEST)) {
      const loaded = await load();
      if (!loaded.manifest.archetype.startsWith('rt-')) continue;
      const game = loaded.create();
      const seat = game.getActiveSeat?.() ?? null;
      if (seat !== null) wrong.push(`${slug} (${seat})`);
    }
    expect(wrong, `these are real-time but claim to have turns: ${wrong.join(', ')}`).toEqual([]);
  });
});
