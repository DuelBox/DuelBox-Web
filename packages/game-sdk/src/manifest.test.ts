import { describe, expect, it } from 'vitest';
import {
  DEVICE_CLASSES,
  gameManifestSchema,
  gameOptionSchema,
  isDesignedForOrientation,
  logicalForOrientation,
  parseGameManifest,
  preferredOrientation,
  rotateHintFor,
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
    // things that may appear; none of the optional fields may materialise unbidden, or a
    // catalogue filter would start hiding games nobody constrained — and, since #1886,
    // a second logical box would appear for a game that has only ever had one layout.
    const parsed = parseGameManifest(baseManifest());
    expect('minViewport' in parsed).toBe(false);
    expect('deviceClasses' in parsed).toBe(false);
    expect('alternateLogical' in parsed).toBe(false);
  });
});

describe('minViewport', () => {
  it('parses a well-formed viewport', () => {
    const parsed = parseGameManifest({
      ...baseManifest(),
      minViewport: { width: 480, height: 640 },
    });
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
    expect(() => parseGameManifest({ ...baseManifest(), deviceClasses: ['watch'] })).toThrow(
      /deviceClasses/,
    );
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
    expect(() =>
      parseGameManifest({ ...baseManifest(), minViewportt: { width: 1, height: 1 } }),
    ).toThrow();
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

/**
 * Orientation (#1886).
 *
 * The field is older than these tests by a hundred manifests and was read by nothing until
 * this issue, so what is under test is a *meaning* newly given to an existing declaration.
 * The first thing to hold, therefore, is that the meaning fits what the catalogue already
 * says: the shapes below are the four real ones — 67 portrait boxes taller than wide, 4
 * landscape boxes wider than tall, 33 square boards and 4 near-square ones on `'any'`.
 */
describe('the orientation a game declares', () => {
  /** The 67-game shape: a tall box that names the way its long axis runs. */
  function portraitGame(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ...baseManifest(),
      logical: { width: 600, height: 1000 },
      orientation: 'portrait',
      ...extra,
    };
  }

  it('accepts every shape the catalogue actually ships', () => {
    expect(parseGameManifest(portraitGame()).orientation).toBe('portrait');
    expect(
      parseGameManifest({
        ...baseManifest(),
        logical: { width: 1000, height: 640 },
        orientation: 'landscape',
      }).orientation,
    ).toBe('landscape');
    // The 33 square boards, and the four near-square ones (Blocks, Solitaire, Sudoku at
    // 900x1000; Paint Fight at 960x1080), all on 'any'.
    expect(parseGameManifest(baseManifest()).orientation).toBe('any');
    expect(
      parseGameManifest({ ...baseManifest(), logical: { width: 900, height: 1000 } }).orientation,
    ).toBe('any');
    expect(
      parseGameManifest({ ...baseManifest(), logical: { width: 960, height: 1080 } }).orientation,
    ).toBe('any');
  });

  it('defaults to "any", so a manifest that says nothing is never nagged', () => {
    const silent: Record<string, unknown> = { ...baseManifest() };
    delete silent.orientation;
    const parsed = parseGameManifest(silent);
    expect(parsed.orientation).toBe('any');
    expect(preferredOrientation(parsed)).toBeNull();
    expect(rotateHintFor(parsed, 'portrait')).toBeNull();
    expect(rotateHintFor(parsed, 'landscape')).toBeNull();
  });

  it('refuses a word its own box contradicts, in both directions', () => {
    // The whole reason this check exists: nothing read the field, so nothing could disagree
    // with it, so a manifest could have said this for a year and stayed green.
    expect(() => parseGameManifest(portraitGame())).not.toThrow();
    expect(() => parseGameManifest(portraitGame({ orientation: 'landscape' }))).toThrow(
      /orientation/,
    );
    expect(() =>
      parseGameManifest({
        ...baseManifest(),
        logical: { width: 1000, height: 600 },
        orientation: 'portrait',
      }),
    ).toThrow(/orientation/);
  });

  it('refuses a preference on a square board, which has no long axis to prefer', () => {
    // 900x900 letterboxes to exactly the same drawn area either way up, so "portrait" there
    // is a word describing something the geometry cannot express.
    expect(() => parseGameManifest({ ...baseManifest(), orientation: 'portrait' })).toThrow(
      /square/,
    );
    expect(() => parseGameManifest({ ...baseManifest(), orientation: 'landscape' })).toThrow(
      /square/,
    );
  });

  it('refuses "any" on a box with a long axis, which is the cheap way out of this issue', () => {
    // A 600x1000 game does not become a game that supports both orientations by having one
    // word changed. It loses two fifths of its board turned sideways.
    expect(() =>
      parseGameManifest({
        ...baseManifest(),
        logical: { width: 600, height: 1000 },
        orientation: 'any',
      }),
    ).toThrow(/alternateLogical/);
    // The bound is a fifth of the board's linear size, so 1.25 exactly is still allowed and
    // the four near-square games in the catalogue sit comfortably inside it.
    expect(() =>
      parseGameManifest({ ...baseManifest(), logical: { width: 800, height: 1000 } }),
    ).not.toThrow();
    expect(() =>
      parseGameManifest({ ...baseManifest(), logical: { width: 799, height: 1000 } }),
    ).toThrow(/orientation/);
  });

  it('reports the preference, and nothing when there is none', () => {
    expect(preferredOrientation(parseGameManifest(portraitGame()))).toBe('portrait');
    expect(preferredOrientation(parseGameManifest(baseManifest()))).toBeNull();
  });
});

describe('the second logical box (alternateLogical)', () => {
  const BOTH_WAYS = {
    ...baseManifest(),
    logical: { width: 600, height: 1000 },
    orientation: 'portrait',
    alternateLogical: { width: 1000, height: 600 },
  };

  it('accepts a box that really is the other way round', () => {
    const parsed = parseGameManifest(BOTH_WAYS);
    expect(parsed.alternateLogical).toEqual({ width: 1000, height: 600 });
  });

  it('refuses a second box that is the same way round, or square', () => {
    expect(() =>
      parseGameManifest({ ...BOTH_WAYS, alternateLogical: { width: 700, height: 1200 } }),
    ).toThrow(/alternateLogical/);
    expect(() =>
      parseGameManifest({ ...BOTH_WAYS, alternateLogical: { width: 800, height: 800 } }),
    ).toThrow(/alternateLogical/);
  });

  it('refuses a second box on a game that declared no first orientation', () => {
    // 'any' already means "this one box serves both", so there is no second orientation left
    // for a second box to be for, and two boxes plus no preference cannot say which is which.
    expect(() =>
      parseGameManifest({ ...baseManifest(), alternateLogical: { width: 1000, height: 600 } }),
    ).toThrow(/alternateLogical/);
  });

  it('is refused a nonsensical dimension the same way the first box is', () => {
    expect(() =>
      parseGameManifest({ ...BOTH_WAYS, alternateLogical: { width: 0, height: 600 } }),
    ).toThrow(/alternateLogical/);
    expect(() =>
      parseGameManifest({ ...BOTH_WAYS, alternateLogical: { width: 1000.5, height: 600 } }),
    ).toThrow(/alternateLogical/);
  });

  it('is what decides which box a match adopts, and only that', () => {
    const both = parseGameManifest(BOTH_WAYS);
    expect(logicalForOrientation(both, 'portrait')).toEqual({ width: 600, height: 1000 });
    expect(logicalForOrientation(both, 'landscape')).toEqual({ width: 1000, height: 600 });

    // Every game in the catalogue today: one box, whichever way the device is held. This is
    // the property that makes the field additive — no existing game's match can change.
    const oneBox = parseGameManifest({
      ...baseManifest(),
      logical: { width: 600, height: 1000 },
      orientation: 'portrait',
    });
    expect(logicalForOrientation(oneBox, 'portrait')).toEqual({ width: 600, height: 1000 });
    expect(logicalForOrientation(oneBox, 'landscape')).toEqual({ width: 600, height: 1000 });

    const square = parseGameManifest(baseManifest());
    expect(logicalForOrientation(square, 'portrait')).toEqual({ width: 900, height: 900 });
    expect(logicalForOrientation(square, 'landscape')).toEqual({ width: 900, height: 900 });
  });
});

describe('what the shell is told about turning the device', () => {
  const PORTRAIT_ONLY = parseGameManifest({
    ...baseManifest(),
    logical: { width: 600, height: 1000 },
    orientation: 'portrait',
  });
  const BOTH = parseGameManifest({
    ...baseManifest(),
    logical: { width: 600, height: 1000 },
    orientation: 'portrait',
    alternateLogical: { width: 1000, height: 600 },
  });
  const EITHER_WAY = parseGameManifest(baseManifest());

  it('derives "designed for" rather than letting a manifest claim it', () => {
    // Supported is orientation plus whether a second box exists, so a manifest cannot say it
    // supports an orientation it has no layout for. That is why there is no second field.
    expect(isDesignedForOrientation(PORTRAIT_ONLY, 'portrait')).toBe(true);
    expect(isDesignedForOrientation(PORTRAIT_ONLY, 'landscape')).toBe(false);
    expect(isDesignedForOrientation(BOTH, 'portrait')).toBe(true);
    expect(isDesignedForOrientation(BOTH, 'landscape')).toBe(true);
    expect(isDesignedForOrientation(EITHER_WAY, 'portrait')).toBe(true);
    expect(isDesignedForOrientation(EITHER_WAY, 'landscape')).toBe(true);
  });

  it('hints in exactly one of the four cases, and says nothing in the other three', () => {
    // A game with no preference never asks; a game already held its way never asks; a game
    // with a layout for where the device is never asks. Only a preference with no second
    // layout has anything to say — and what it has is a suggestion, not a demand.
    expect(rotateHintFor(PORTRAIT_ONLY, 'landscape')).toBe('portrait');
    expect(rotateHintFor(PORTRAIT_ONLY, 'portrait')).toBeNull();
    expect(rotateHintFor(BOTH, 'landscape')).toBeNull();
    expect(rotateHintFor(EITHER_WAY, 'landscape')).toBeNull();
  });

  it('is never a gate: a hinted game is still fully playable where it is', () => {
    // The non-blocking half of #1886, as far as a pure function can carry it. A hint is the
    // only thing produced here — there is no "unsupported" answer for the shell to act on,
    // no boolean that reads as "refuse", and `supportsViewport`, the field that *is* a gate,
    // is untouched by any of this.
    expect(rotateHintFor(PORTRAIT_ONLY, 'landscape')).not.toBeNull();
    expect(supportsViewport(PORTRAIT_ONLY, { width: 844, height: 390 })).toBe(true);
    expect(supportsDeviceClass(PORTRAIT_ONLY, 'phone')).toBe(true);
  });
});
