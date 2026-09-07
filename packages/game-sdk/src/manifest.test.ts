import { describe, expect, it } from 'vitest';
import {
  DEVICE_CLASSES,
  gameManifestSchema,
  gameOptionSchema,
  parseGameManifest,
  supportedPresentations,
  supportsDeviceClass,
  supportsViewport,
  type GameManifest,
} from './manifest.js';

/**
 * A manifest with every required field and none of the optional ones — the shape every
 * game in the catalogue ships and the baseline the new optional fields must not disturb.
 */
function baseManifest(): Record<string, unknown> {
  return {
    id: 'sample-game',
    name: 'Sample Game',
    category: 'Board',
    archetype: 'turn-board',
    modes: ['friend', 'bot'],
    presentations: ['shared-screen', 'single-seat'],
    logical: { width: 900, height: 900 },
    orientation: 'any',
    zoneSplit: 'shared-board',
    roundSeconds: 90,
    controls: { keyboard: 'Move with the arrow keys and place with Space', pointer: 'Tap a cell' },
  };
}

describe('the manifest without the new fields', () => {
  it('still validates, so every existing manifest is untouched', () => {
    const parsed = parseGameManifest(baseManifest());
    expect(parsed.id).toBe('sample-game');
  });

  it('leaves handoff and options absent when not declared', () => {
    // Optional rather than defaulted, so the inferred type does not force the field onto the
    // hundred manifests already compiled — an absent field reads as undefined, and consumers
    // treat that as "off" / "no options".
    const parsed = parseGameManifest(baseManifest());
    expect(parsed.handoff).toBeUndefined();
    expect(parsed.options).toBeUndefined();
  });
});

describe('the handoff field (#134)', () => {
  it('accepts an explicit opt-in', () => {
    expect(parseGameManifest({ ...baseManifest(), handoff: true }).handoff).toBe(true);
  });

  it('rejects a non-boolean', () => {
    expect(() => parseGameManifest({ ...baseManifest(), handoff: 'yes' })).toThrow();
  });
});

describe('the options array (#1751)', () => {
  it('accepts a select, a toggle and a range together', () => {
    const parsed = parseGameManifest({
      ...baseManifest(),
      options: [
        {
          type: 'select',
          id: 'board-size',
          label: 'Board size',
          choices: [
            { value: 'small', label: 'Small' },
            { value: 'large', label: 'Large' },
          ],
          default: 'small',
        },
        { type: 'toggle', id: 'obstacles', label: 'Obstacles', default: false },
        { type: 'range', id: 'lives', label: 'Lives', min: 1, max: 5, step: 1, default: 3 },
      ],
    });
    expect(parsed.options).toHaveLength(3);
  });

  it('defaults a range step to 1', () => {
    const opt = gameOptionSchema.parse({
      type: 'range',
      id: 'lives',
      label: 'Lives',
      min: 1,
      max: 5,
      default: 3,
    });
    expect(opt.type === 'range' && opt.step).toBe(1);
  });

  it('rejects a select whose default is not one of its choices', () => {
    expect(() =>
      parseGameManifest({
        ...baseManifest(),
        options: [
          {
            type: 'select',
            id: 'board-size',
            label: 'Board size',
            choices: [
              { value: 'small', label: 'Small' },
              { value: 'large', label: 'Large' },
            ],
            default: 'huge',
          },
        ],
      }),
    ).toThrow();
  });

  it('rejects a range with min >= max', () => {
    expect(() =>
      gameOptionSchema.parse({ type: 'range', id: 'x', label: 'X', min: 5, max: 5, default: 5 }),
    ).toThrow();
  });

  it('rejects a range default outside its bounds', () => {
    expect(() =>
      gameOptionSchema.parse({ type: 'range', id: 'x', label: 'X', min: 1, max: 3, default: 9 }),
    ).toThrow();
  });

  it('rejects duplicate option ids within a game', () => {
    expect(() =>
      parseGameManifest({
        ...baseManifest(),
        options: [
          { type: 'toggle', id: 'same', label: 'One', default: false },
          { type: 'toggle', id: 'same', label: 'Two', default: true },
        ],
      }),
    ).toThrow();
  });

  it('rejects an option id that is not kebab-case', () => {
    expect(() =>
      gameOptionSchema.parse({ type: 'toggle', id: 'Board_Size', label: 'X', default: false }),
    ).toThrow();
  });

  it('rejects an unknown option type', () => {
    expect(() =>
      gameOptionSchema.parse({ type: 'colour', id: 'x', label: 'X', default: 'red' }),
    ).toThrow();
  });
});

describe('the schema stays strict', () => {
  it('still rejects an unknown top-level key', () => {
    expect(() => gameManifestSchema.parse({ ...baseManifest(), nonsense: 1 })).toThrow();
  });
});

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
