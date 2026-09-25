/**
 * Neutralising prototype-pollution keys in anything parsed from outside this process (#2365).
 *
 * `JSON.parse('{"__proto__":{…}}')` does not, on its own, corrupt `Object.prototype` — the
 * key it produces is a plain own data property named `__proto__`, and reading it back gives
 * that data rather than the prototype. The danger is one step later: a recursive merge, a
 * `for…in` copy, or any code that walks the parsed keys and assigns them onto another object
 * can carry `__proto__`, `constructor` or `prototype` up a prototype chain and poison every
 * object in the runtime (CWE-1321). The threat model calls this out as §4, and
 * `docs/secure-coding.md` rule 1 is the same rule stated for a reviewer: never merge or
 * spread a parsed object — validate known keys into a fresh one.
 *
 * This module is the shared tool that makes that cheap. `stripForbiddenKeys` walks a parsed
 * value and deletes the three dangerous keys at every depth, so a value that has been through
 * it cannot carry a pollution payload no matter what a later reader does with it. It is the
 * belt to the secure-coding rule's braces: a store that already copies known keys is
 * unaffected, and one that ever forgets to is still safe.
 *
 * It strips rather than rejects because storage is not a trust boundary a person watches: a
 * value under a `duelbox:` key was written by another tab, an older build, or somebody with
 * the console open, and the caller's contract everywhere is "a bad value costs the player a
 * default, never a crash". Rejecting a whole document because one nested object carried a
 * stray key would throw away the favourites beside it. A trace pasted into an issue is the
 * one input a person does watch, so `record.ts` rejects there instead.
 */

/** The keys JSON must never be allowed to carry into a live object. */
export const FORBIDDEN_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

const FORBIDDEN: ReadonlySet<string> = new Set(FORBIDDEN_KEYS);

/** True for a key that can reach an object's prototype chain. */
export function isForbiddenKey(key: string): boolean {
  return FORBIDDEN.has(key);
}

/**
 * Removes every prototype-polluting key from `value`, in place, at every depth, and returns
 * the same reference for convenience.
 *
 * Arrays are walked, objects are scrubbed key by key, and primitives pass straight through.
 * The `seen` set guards against a cyclic graph — `JSON.parse` never makes one, but a caller
 * that hands this a live object should not spin.
 */
export function stripForbiddenKeys<T>(value: T): T {
  scrub(value, new Set<object>());
  return value;
}

function scrub(value: unknown, seen: Set<object>): void {
  if (typeof value !== 'object' || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value as unknown[]) scrub(item, seen);
    return;
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN.has(key)) {
      // `delete record.__proto__` would go through the accessor and do nothing; the own data
      // property that `JSON.parse` created is removed by keying it explicitly.
      Reflect.deleteProperty(record, key);
      continue;
    }
    scrub(record[key], seen);
  }
}

/**
 * `JSON.parse` with the pollution keys stripped from whatever it produces.
 *
 * Throws on invalid JSON exactly as `JSON.parse` does — the caller decides whether that is an
 * error to surface or a reason to fall back. `readJson` in `local-store.ts` wraps it in the
 * try/catch every store already shares; `player-data.ts` turns the throw into a message.
 */
export function parseHardenedJson(text: string): unknown {
  return stripForbiddenKeys(JSON.parse(text) as unknown);
}
