/**
 * The one place the site touches `localStorage`.
 *
 * Every store — the remembered setup, favourites, recent games, settings — reads and
 * writes through these five functions, and nothing else in `apps/web` calls
 * `getItem`, `setItem` or `removeItem` at all. That is a property rather than a
 * preference: `privacy-claims.test.ts` asserts that exactly one module writes to storage,
 * which is what lets the privacy page say "under keys starting `duelbox:`" and be checked
 * against the code rather than trusted.
 *
 * It also means every store inherits the same failure story once. `localStorage` is
 * genuinely absent in private browsing on some engines, throws on read when blocked by
 * policy, and throws on write when the quota is full. None of those is worth a broken
 * page — losing a favourite costs one tap — so every function here returns a fallback
 * and never throws. A caller does not need a try/catch of its own, and that is the point:
 * `last-mode.ts` was mostly failure paths before this existed, and four more stores each
 * carrying their own copy would have been four more sets to get right.
 *
 * Nothing here reaches for storage at import time. The site is a static export, and these
 * modules are evaluated on the build machine where there is no `localStorage`; the first
 * read happens inside an effect, so the server's HTML and the browser's first paint agree.
 */

import { stripForbiddenKeys } from './hardened-json';

/** Every key the site writes starts with this, so a reader of DevTools knows whose it is. */
export const KEY_PREFIX = 'duelbox:';

/** A plain JSON object: not null, not an array, not a primitive. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The parsed value under `key`, or `null` if there is nothing usable there.
 *
 * `null` for absent, for unparseable and for storage throwing alike, because the caller
 * does the same thing in all three cases: fall back to defaults. A stored literal `null`
 * also comes back as `null`, which is the right answer — it is not a shape any store
 * reads.
 */
export function readJson(key: string): unknown {
  try {
    // No optional chaining: the type says localStorage is always there, and in private
    // browsing on some engines it is not. Reaching for it throws, which the catch below
    // handles — the same path as a parse failure, and for the same reason.
    const raw = globalThis.localStorage.getItem(key);
    if (raw === null) return null;
    // Storage is a boundary (threat model §4): whatever is under the key was written by
    // another tab, an older build, or a console, and a crafted `__proto__`/`constructor`/
    // `prototype` key would ride a later merge into the runtime's prototype chain. Every
    // store reads through here, so stripping those keys once protects all of them —
    // `last-mode`, `head-to-head`, `settings`, `favourites`, `recent`, `tournament-store`
    // and the rest inherit the guard without each re-stating it (#2365).
    return stripForbiddenKeys(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/**
 * `JSON.stringify` as it actually behaves, which the library declaration does not admit:
 * `undefined`, a function or a symbol serialise to nothing at all, and writing the string
 * "undefined" in their place would leave a value no reader can parse.
 */
function serialise(value: unknown): string | undefined {
  return JSON.stringify(value);
}

/**
 * Writes `value` as JSON under `key`. True if it was written; false, and never a throw,
 * if storage is full, disabled or absent — or if `value` is something JSON cannot carry.
 *
 * The return is for the one caller that has to tell the player, which is the import on
 * the settings page. Everything else ignores it: a favourite that did not stick is not an
 * error anybody can act on.
 */
export function writeJson(key: string, value: unknown): boolean {
  try {
    const serialised = serialise(value);
    if (serialised === undefined) return false;
    globalThis.localStorage.setItem(key, serialised);
    return true;
  } catch {
    return false;
  }
}

/** Removes `key`. Absent storage and an absent key are both a successful removal. */
export function removeJson(key: string): void {
  try {
    globalThis.localStorage.removeItem(key);
  } catch {
    // Storage disabled or unavailable, in which case there was nothing to remove.
  }
}

/**
 * The object under `key`, only if it is a plain object whose `version` is exactly
 * `version`; otherwise `null`.
 *
 * An unrecognised version is treated as no data at all rather than guessed at. A future
 * shape is not something this build can interpret, and an older one that a store still
 * wants to migrate is read through {@link readJson} by that store, which is the one place
 * the old shape is known.
 */
export function readVersioned(key: string, version: number): Record<string, unknown> | null {
  const parsed = readJson(key);
  if (!isRecord(parsed) || parsed['version'] !== version) return null;
  return parsed;
}

/** Writes `{ version, ...data }` under `key`. Same contract as {@link writeJson}. */
export function writeVersioned(
  key: string,
  version: number,
  data: Record<string, unknown>,
): boolean {
  return writeJson(key, { version, ...data });
}

/**
 * The strings in `value`, in order, with duplicates and everything else dropped.
 *
 * Two stores keep a list of route slugs, and a list read back from storage is untrusted
 * whoever wrote it. An empty string is dropped along with the non-strings: no route has
 * an empty slug, so it can only be junk, and junk in a favourites list becomes a tile
 * that opens nothing.
 */
export function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'string' || entry.length === 0 || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}
