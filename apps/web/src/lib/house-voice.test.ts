import { describe, expect, it } from 'vitest';
import { AMERICAN, NEVER } from './house-voice';

/**
 * The tables that hold three surfaces' prose, held to their own stated method.
 *
 * `AMERICAN` is matched with `\b…\b` and nothing else, which its docstring says in bold and
 * which means every inflection has to be its own row. Twice now a batch has added part of a
 * family: first five plurals were missing beside their singulars, and then the widening that
 * fixed that added `travelers` without `traveler`. Both defects passed every test in the
 * repository, because the three files that read this table check *copy* against it and
 * nothing checked the table.
 *
 * So this checks the table. It knows one rule, and the rule is the one the two defects broke.
 *
 * **A plural implies its singular.** Take a row whose American and British spellings both end
 * in `s`; drop the `s` from each. If what is left still differs between the two dialects, the
 * singular is a word this shell can spell wrongly, and it has to be a row of its own. `colors`
 * implies `color`; `travelers` implies `traveler`. A row where the shortened pair no longer
 * differs — were one ever added — implies nothing and is left alone.
 *
 * There is deliberately no matching rule for `-ed` and `-ing`. British doubles the l:
 * `travelled` is not `travelled` minus a suffix, and a rule that tried would demand a
 * `travel`/`travell` row, which is not a spelling difference at all. A guard that fires on
 * correct English is a guard somebody turns off — the same reason the docstring gives for not
 * reaching for a stemmer.
 */

/** A row's British spelling by its American one, for asking whether a shortened pair differs. */
const BRITISH = new Map(AMERICAN);

describe('the American-spellings table', () => {
  it('lists the singular of every plural it lists', () => {
    const missing: string[] = [];
    for (const [american, british] of AMERICAN) {
      if (!american.endsWith('s') || !british.endsWith('s')) continue;
      const singular = american.slice(0, -1);
      const britishSingular = british.slice(0, -1);
      // A pair that stops differing once the `s` comes off is not a spelling this shell can
      // get wrong in the singular, so it implies no row.
      if (singular === britishSingular) continue;
      if (!BRITISH.has(singular)) {
        missing.push(
          `"${american}" is listed and "${singular}" is not (British "${britishSingular}")`,
        );
      }
    }
    expect(
      missing,
      'a plural whose singular is missing passes the singular everywhere it fails the plural,' +
        ' on all three surfaces that read this table:\n' +
        missing.join('\n'),
    ).toEqual([]);
  });

  it('is a table this rule can actually find a hole in', () => {
    // The rule above is worth nothing if it cannot fail, and it is written over the table it
    // guards, so it is shown a table with the hole in it. `travelers` without `traveler` is
    // not hypothetical: it is what shipped into this file and what this test was written for.
    const holed: ReadonlyArray<readonly [string, string]> = [
      ['traveled', 'travelled'],
      ['travelers', 'travellers'],
    ];
    const found = holed.filter(([american, british]) => {
      if (!american.endsWith('s') || !british.endsWith('s')) return false;
      const singular = american.slice(0, -1);
      if (singular === british.slice(0, -1)) return false;
      return !new Map(holed).has(singular);
    });
    expect(found.map(([american]) => american)).toEqual(['travelers']);
  });

  it('spells every entry the way it says the shell spells', () => {
    const wrong: string[] = [];
    for (const [american, british] of AMERICAN) {
      if (american === british) wrong.push(`"${american}" is listed as a correction of itself`);
      if (!/^[a-z]+$/.test(american)) wrong.push(`"${american}" is not one lower-case word`);
      if (!/^[a-z]+$/.test(british)) wrong.push(`"${british}" is not one lower-case word`);
      // Matching is case-insensitive on a word boundary, so a row whose American spelling is
      // a prefix of nothing British still has to be a word the boundary can isolate.
      if (new RegExp(String.raw`\b${american}\b`, 'i').test(british)) {
        wrong.push(`"${american}" matches its own British spelling "${british}"`);
      }
    }
    expect(wrong, `rows that cannot do their job:\n${wrong.join('\n')}`).toEqual([]);
    expect(new Set(AMERICAN.map(([american]) => american)).size).toBe(AMERICAN.length);
  });
});

describe('the instruments no game has', () => {
  it('names an instrument for every pattern, and matches the form it names', () => {
    // `NEVER` is patterns rather than words, so a row can silently stop matching anything
    // after an edit. Each is shown the phrase it exists to catch, built from its own label.
    const wrong: string[] = [];
    for (const [pattern, what] of NEVER) {
      if (what.trim() === '') wrong.push(`${String(pattern)} has no name to report`);
      if (!pattern.flags.includes('i')) wrong.push(`${String(pattern)} is case-sensitive`);
    }
    expect(wrong, `patterns that cannot report themselves:\n${wrong.join('\n')}`).toEqual([]);
    expect(NEVER.some(([pattern]) => pattern.test('use the joystick'))).toBe(true);
    expect(NEVER.some(([pattern]) => pattern.test('a knife sticks in the wood'))).toBe(false);
  });
});
