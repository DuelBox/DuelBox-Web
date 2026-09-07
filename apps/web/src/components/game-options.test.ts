import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameOption } from '@duelbox/game-sdk';
import {
  coerceOptionValue,
  defaultOptionValues,
  readOptionValues,
  writeOptionValue,
} from './game-options';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(join(here, name), 'utf8');

/** A minimal localStorage, so these tests do not need a DOM — the shape last-mode.test uses. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
    key: () => null,
    length: 0,
  } as Storage;
}

function install(storage: Storage | undefined): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

const OPTIONS: readonly GameOption[] = [
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
];

describe('defaults and coercion (#1751)', () => {
  it('reads the declared default for every option', () => {
    expect(defaultOptionValues(OPTIONS)).toEqual({
      'board-size': 'small',
      obstacles: false,
      lives: 3,
    });
  });

  it('keeps a valid stored value and rejects an invalid one', () => {
    const [select, toggle, range] = OPTIONS as [GameOption, GameOption, GameOption];
    expect(coerceOptionValue(select, 'large')).toBe('large');
    expect(coerceOptionValue(select, 'huge')).toBe('small'); // not a choice → default
    expect(coerceOptionValue(toggle, true)).toBe(true);
    expect(coerceOptionValue(toggle, 'yes')).toBe(false); // not a boolean → default
    expect(coerceOptionValue(range, 4)).toBe(4);
    expect(coerceOptionValue(range, 99)).toBe(5); // clamped to max
    expect(coerceOptionValue(range, 'x')).toBe(3); // not a number → default
  });
});

describe('persistence', () => {
  beforeEach(() => {
    install(fakeStorage());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns defaults for a game never configured', () => {
    expect(readOptionValues('chess', OPTIONS)).toEqual({
      'board-size': 'small',
      obstacles: false,
      lives: 3,
    });
  });

  it('remembers a choice and reads it back', () => {
    writeOptionValue('chess', 'board-size', 'large');
    writeOptionValue('chess', 'lives', 5);
    expect(readOptionValues('chess', OPTIONS)).toEqual({
      'board-size': 'large',
      obstacles: false,
      lives: 5,
    });
  });

  it('keeps each game separate from the others', () => {
    writeOptionValue('chess', 'lives', 5);
    writeOptionValue('go', 'lives', 2);
    expect(readOptionValues('chess', OPTIONS).lives).toBe(5);
    expect(readOptionValues('go', OPTIONS).lives).toBe(2);
  });

  it('returns an empty object for a game with no options, so the panel shows nothing', () => {
    expect(readOptionValues('chess', [])).toEqual({});
  });

  it('never throws when storage is absent', () => {
    install(undefined);
    expect(() => writeOptionValue('chess', 'lives', 4)).not.toThrow();
    expect(readOptionValues('chess', OPTIONS).lives).toBe(3);
  });
});

describe('the panel renders generically', () => {
  it('has no per-game branching — it maps over the options and switches on type', () => {
    const source = read('GameOptionsPanel.tsx');
    expect(source).toContain('options.map');
    expect(source).toContain("option.type === 'select'");
    expect(source).toContain("option.type === 'toggle'");
    expect(source).toContain("option.type === 'range'");
    // A game with no options shows nothing.
    expect(source).toContain('options.length === 0');
  });
});
