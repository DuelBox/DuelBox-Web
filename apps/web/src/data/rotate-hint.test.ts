/**
 * How many games the rotate prompt can ever have anything to say to (#136), counted rather
 * than stated.
 *
 * `rotateHintFor`'s docstring used to end "and null for every game in the catalogue as it
 * stands", which was wrong the day it was written: no game declares `alternateLogical`, so
 * every game that declares an orientation has a hint whenever the device is the other way up.
 * A number in a comment is a number nothing recomputes, and this repository keeps a tally of
 * where that has cost it.
 *
 * Two directions, because either would be a defect on its own. A build where the count goes
 * to zero has a prompt that can never show — a component shipping bytes for nobody, which is
 * the shape three libraries here were found in. A build where it reaches every game means
 * `'any'` has stopped meaning "one box, both ways up", and 108 pairs would be nagged about
 * how they are holding the device.
 */
import { describe, expect, it } from 'vitest';
import { rotateHintFor } from '@duelbox/game-sdk';
import { MANIFESTS } from './controls';

const hinted = (held: 'portrait' | 'landscape') =>
  MANIFESTS.filter((manifest) => rotateHintFor(manifest, held) !== null);

describe('the rotate hint across the catalogue', () => {
  it('has something to say to some games and not to all of them', () => {
    const sideways = hinted('landscape');
    const upright = hinted('portrait');
    expect(sideways.length + upright.length).toBeGreaterThan(0);
    expect(sideways.length).toBeLessThan(MANIFESTS.length);
    expect(upright.length).toBeLessThan(MANIFESTS.length);
  });

  it('says nothing to a game with no preference, whichever way the device is', () => {
    for (const manifest of MANIFESTS.filter((entry) => entry.orientation === 'any')) {
      expect(rotateHintFor(manifest, 'portrait'), manifest.id).toBeNull();
      expect(rotateHintFor(manifest, 'landscape'), manifest.id).toBeNull();
    }
  });

  it('says nothing to a game already held the way it asked for', () => {
    for (const manifest of MANIFESTS) {
      if (manifest.orientation === 'any') continue;
      expect(rotateHintFor(manifest, manifest.orientation), manifest.id).toBeNull();
    }
  });

  it('names the orientation the game prefers, and never the one it is in', () => {
    for (const manifest of MANIFESTS) {
      if (manifest.orientation === 'any') continue;
      const other = manifest.orientation === 'portrait' ? 'landscape' : 'portrait';
      expect(rotateHintFor(manifest, other), manifest.id).toBe(manifest.orientation);
    }
  });
});
