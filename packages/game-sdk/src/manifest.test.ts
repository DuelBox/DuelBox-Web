import { describe, expect, it } from 'vitest';
import { gameManifestSchema, gameOptionSchema, parseGameManifest } from './manifest.js';

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
