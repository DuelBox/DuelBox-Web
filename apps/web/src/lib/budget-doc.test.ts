/**
 * `docs/performance-budgets.md` against `size-budget.json`, in both directions.
 *
 * The doc states each budget twice — as kilobytes and as bytes — beside prose explaining what
 * the number is for. Nothing recomputed either, so it drifted: on the day this was written its
 * shell row said **163.0 KB (166,912 B)** against a file that had said 167,936 since the
 * service worker landed, and it had no row at all for `speculatedBytes`, which had existed for
 * a day and is the largest number in the file.
 *
 * That is the failure CLAUDE.md's tally is about, in its mildest form: a statement of a fact
 * kept by hand next to the fact. The table is the first thing anyone reads to find out what
 * they are allowed to spend, so a stale row is worse than no row — it is a budget somebody
 * plans against and then fails CI over.
 *
 * Both directions matter. A budget in the file with no row here is a limit a reader cannot
 * find; a row here for a budget the file does not have is a limit that is not enforced.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../../', import.meta.url);
const doc = readFileSync(fileURLToPath(new URL('docs/performance-budgets.md', ROOT)), 'utf8');
const budget = JSON.parse(
  readFileSync(fileURLToPath(new URL('size-budget.json', ROOT)), 'utf8'),
) as Record<string, unknown>;

/** The numeric budgets, which are every key in the file that does not start with `_`. */
const limits = Object.entries(budget).filter(
  (entry): entry is [string, number] => !entry[0].startsWith('_') && typeof entry[1] === 'number',
);

/** The rows of the budget table: name, the KB it claims, and the bytes it claims. */
const rows = [...doc.matchAll(/`(\w+)` — \*\*([\d.]+) KB\*\* \(([\d,]+) B\)/g)].map(
  ([, key, kb, bytes]) => ({
    key: key ?? '',
    kb: Number(kb),
    bytes: Number((bytes ?? '').replaceAll(',', '')),
  }),
);

describe('the budget table in docs/performance-budgets.md', () => {
  it('has a row for every budget the guard enforces', () => {
    expect(rows.map((row) => row.key).sort()).toEqual(limits.map(([key]) => key).sort());
  });

  it.each(limits)('states %s in bytes exactly as size-budget.json holds it', (key, bytes) => {
    const row = rows.find((candidate) => candidate.key === key);
    expect(row, `docs/performance-budgets.md has no row for ${key}`).toBeDefined();
    expect(row?.bytes).toBe(bytes);
  });

  it.each(limits)('states %s in KB as the same number the guard prints', (key, bytes) => {
    // `check-size.mjs` reports one decimal place of KiB, and the table is what a reader
    // compares a failing build against — so the two have to round the same way.
    const row = rows.find((candidate) => candidate.key === key);
    expect(row?.kb).toBe(Number((bytes / 1024).toFixed(1)));
  });
});
