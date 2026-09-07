import { describe, expect, it } from 'vitest';
import {
  DEVICE_CLASSES,
  gameManifestSchema,
  parseGameManifest,
  supportedPresentations,
  supportsDeviceClass,
  supportsViewport,
  type GameManifest,
} from './manifest.js';

/**
 * The manifest schema, and the three crossplay fields #1864 adds.
 *
 * `minViewport`, `deviceClasses` and the `supportedPresentations` surface must be **optional
 * and additive**: 107 manifests already ship without them, and the whole point of the field
 * is that the catalogue can filter by a device constraint a game only declares if it has one.
 * The first assertion here is the one that matters — a manifest with none of the new fields
 * still validates, byte for byte the object it went in as, or every existing game breaks.
 */

/** A minimal manifest that omits every field #1864 adds. The shape every built game has today. */
function baseManifest(): Record<string, unknown> {
  return {
    id: 'example-game',
    name: 'Example Game',
    category: 'Test',
    archetype: 'turn-aim',
    modes: ['friend', 'bot'],
    presentations: ['shared-screen', 'single-seat'],
    logical: { width: 900, height: 1200 },
    orientation: 'portrait',
    zoneSplit: 'shared-board',
    roundSeconds: 90,
    controls: {
      keyboard: 'Player one with A and D, player two with the arrows; Space or Enter to fire',
      pointer: 'Drag to aim, release to fire',
    },
  };
}

describe('the new crossplay manifest fields are optional', () => {
  it('validates a manifest that declares none of them', () => {
    const parsed = parseGameManifest(baseManifest());
    expect(parsed.minViewport).toBeUndefined();
    expect(parsed.deviceClasses).toBeUndefined();
  });

  it('leaves an existing manifest object unchanged through a round-trip', () => {
    // The defaults zod fills (orientation, tags, pointer, sameInputClassOnly) are the only
    // things that may appear; none of the three new fields may materialise unbidden, or a
    // catalogue filter would start hiding games nobody constrained.
    const parsed = parseGameManifest(baseManifest());
    expect('minViewport' in parsed).toBe(false);
    expect('deviceClasses' in parsed).toBe(false);
  });
});

describe('minViewport', () => {
  it('parses a well-formed viewport', () => {
    const parsed = parseGameManifest({ ...baseManifest(), minViewport: { width: 480, height: 640 } });
    expect(parsed.minViewport).toEqual({ width: 480, height: 640 });
  });

  it('refuses a non-positive or non-integer dimension', () => {
    expect(() =>
      parseGameManifest({ ...baseManifest(), minViewport: { width: 0, height: 640 } }),
    ).toThrow(/minViewport/);
    expect(() =>
      parseGameManifest({ ...baseManifest(), minViewport: { width: 480.5, height: 640 } }),
    ).toThrow(/minViewport/);
    expect(() =>
      parseGameManifest({ ...baseManifest(), minViewport: { width: 480, height: -1 } }),
    ).toThrow(/minViewport/);
  });

  it('gates a device by both dimensions', () => {
    const game = parseGameManifest({
      ...baseManifest(),
      minViewport: { width: 480, height: 640 },
    });
    expect(supportsViewport(game, { width: 480, height: 640 })).toBe(true);
    expect(supportsViewport(game, { width: 1440, height: 900 })).toBe(true);
    expect(supportsViewport(game, { width: 320, height: 900 })).toBe(false);
    expect(supportsViewport(game, { width: 900, height: 320 })).toBe(false);
  });

  it('makes no claim when it is absent', () => {
    const game = parseGameManifest(baseManifest());
    expect(supportsViewport(game, { width: 320, height: 480 })).toBe(true);
    expect(supportsViewport(game, { width: 1, height: 1 })).toBe(true);
  });
});

describe('deviceClasses', () => {
  it('parses a subset of the known classes', () => {
    const game = parseGameManifest({
      ...baseManifest(),
      deviceClasses: ['tablet', 'laptop', 'wide'],
    });
    expect(game.deviceClasses).toEqual(['tablet', 'laptop', 'wide']);
  });

  it('refuses an unknown class and an empty list', () => {
    expect(() =>
      parseGameManifest({ ...baseManifest(), deviceClasses: ['watch'] }),
    ).toThrow(/deviceClasses/);
    expect(() => parseGameManifest({ ...baseManifest(), deviceClasses: [] })).toThrow(
      /deviceClasses/,
    );
  });

  it('supports every class when absent, and exactly the listed ones otherwise', () => {
    const anywhere = parseGameManifest(baseManifest());
    for (const cls of DEVICE_CLASSES) expect(supportsDeviceClass(anywhere, cls)).toBe(true);

    const bigOnly = parseGameManifest({ ...baseManifest(), deviceClasses: ['laptop', 'wide'] });
    expect(supportsDeviceClass(bigOnly, 'compact')).toBe(false);
    expect(supportsDeviceClass(bigOnly, 'phone')).toBe(false);
    expect(supportsDeviceClass(bigOnly, 'laptop')).toBe(true);
    expect(supportsDeviceClass(bigOnly, 'wide')).toBe(true);
  });
});

describe('supportedPresentations surfaces the existing declaration', () => {
  it('returns exactly the manifest presentations', () => {
    const both = parseGameManifest(baseManifest());
    expect(supportedPresentations(both)).toEqual(['shared-screen', 'single-seat']);

    const sharedOnly = parseGameManifest({ ...baseManifest(), presentations: ['shared-screen'] });
    expect(supportedPresentations(sharedOnly)).toEqual(['shared-screen']);
  });
});

describe('the schema still refuses what it always did', () => {
  it('rejects an unknown top-level field, new ones included', () => {
    // `.strict()` is what makes a typo a build error rather than a silently ignored field, so
    // the additive change must not have loosened it.
    expect(() => parseGameManifest({ ...baseManifest(), minViewportt: { width: 1, height: 1 } })).toThrow();
    expect(() => parseGameManifest({ ...baseManifest(), somethingNew: true })).toThrow();
  });

  it('accepts the fields through the raw schema, not only the throwing wrapper', () => {
    const result = gameManifestSchema.safeParse({
      ...baseManifest(),
      minViewport: { width: 640, height: 480 },
      deviceClasses: ['tablet', 'laptop', 'wide'],
    });
    expect(result.success).toBe(true);
    const manifest: GameManifest = result.success
      ? result.data
      : (undefined as unknown as GameManifest);
    expect(manifest.minViewport).toEqual({ width: 640, height: 480 });
  });
});
