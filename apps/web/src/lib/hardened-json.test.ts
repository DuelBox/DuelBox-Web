import { afterEach, describe, expect, it } from 'vitest';
import {
  FORBIDDEN_KEYS,
  isForbiddenKey,
  parseHardenedJson,
  stripForbiddenKeys,
} from './hardened-json';

/**
 * The property under test is global, so a leak from one case would silently pass the next.
 * Every case asserts `({}).polluted === undefined`, and this removes the key even if one ever
 * does not, so a genuine regression fails loudly here rather than somewhere unrelated later.
 */
afterEach(() => {
  delete (Object.prototype as Record<string, unknown>)['polluted'];
});

/** The recursive-merge pattern that turns a `__proto__` key into global pollution. */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    const incoming = source[key];
    const existing = target[key];
    if (
      typeof incoming === 'object' &&
      incoming !== null &&
      typeof existing === 'object' &&
      existing !== null
    ) {
      deepMerge(existing as Record<string, unknown>, incoming as Record<string, unknown>);
    } else {
      target[key] = incoming;
    }
  }
}

describe('stripForbiddenKeys', () => {
  it('drops a top-level __proto__ payload so a later merge cannot pollute', () => {
    const parsed = JSON.parse('{"__proto__":{"polluted":1},"keep":2}') as Record<string, unknown>;
    const clean = stripForbiddenKeys(parsed);

    expect(Object.prototype.hasOwnProperty.call(clean, '__proto__')).toBe(false);
    expect(clean['keep']).toBe(2);

    // Prove the danger is actually gone: the merge that would have polluted now cannot.
    deepMerge({ keep: 0 }, clean);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('drops __proto__ nested arbitrarily deep', () => {
    const clean = parseHardenedJson(
      '{"a":{"b":[{"__proto__":{"polluted":1}}]},"ok":true}',
    ) as Record<string, unknown>;
    deepMerge({}, clean);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect((clean['a'] as Record<string, unknown>)['b']).toHaveLength(1);
  });

  it('drops the constructor and prototype chain payloads too', () => {
    const clean = parseHardenedJson(
      '{"constructor":{"prototype":{"polluted":1}},"prototype":{"polluted":2}}',
    ) as Record<string, unknown>;
    expect(Object.keys(clean)).toEqual([]);
    deepMerge({}, clean);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('leaves legitimate data untouched and round-trips it', () => {
    const value = { version: 1, games: { chess: { mode: 'bot' } }, list: ['a', 'b'] };
    const clean = stripForbiddenKeys(structuredClone(value));
    expect(clean).toEqual(value);
  });

  it('passes primitives and null through unchanged', () => {
    expect(stripForbiddenKeys(7)).toBe(7);
    expect(stripForbiddenKeys('x')).toBe('x');
    expect(stripForbiddenKeys(null)).toBe(null);
  });

  it('does not loop on a cyclic object', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic['self'] = cyclic;
    expect(() => stripForbiddenKeys(cyclic)).not.toThrow();
  });
});

describe('isForbiddenKey', () => {
  it('names exactly the three dangerous keys', () => {
    expect(FORBIDDEN_KEYS).toEqual(['__proto__', 'constructor', 'prototype']);
    for (const key of FORBIDDEN_KEYS) expect(isForbiddenKey(key)).toBe(true);
    expect(isForbiddenKey('mode')).toBe(false);
    expect(isForbiddenKey('__proto__ ')).toBe(false);
  });
});
