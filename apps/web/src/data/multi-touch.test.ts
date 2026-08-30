import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The price of the finger count.
 *
 * #2498: the engine has always tracked ten concurrent pointers with per-seat ownership and
 * has never let a game see any of it — `SeatSources.pointerCount` was collapsed into
 * `pointerActive` inside `input.ts` and never exported. Measured before the field existed,
 * five fingers down in one seat's zone gave a game one nullable position and no count at all.
 *
 * That made `sameInputClassOnly` a trap rather than a route. The flag exists so a game that
 * cannot be made fair across input families can declare itself same-class-only instead of
 * shipping unfair — but for a multi-touch mechanic, setting it bought nothing, because the
 * game layer still saw one finger. It would have advertised a restriction that gave the
 * player no game in return, which is worse than either honest alternative. Money Grabber
 * says so at length in its SPEC and took the other route: "all the fingers" became a grab
 * *radius* rather than a finger *count*, and the game is cross-device fair.
 *
 * `SeatInputView.pointerCount` now exposes the number. This is what keeps that from being a
 * new way to ship unfair.
 *
 * ## Why a finger count must cost the flag
 *
 * A count has no fair keyboard equivalent, and unlike most parity gaps this one cannot be
 * narrowed by tuning. `docs/keyboard-rollover.md` settles it on the hardware: a commodity
 * membrane keyboard scans a grid rather than wiring a switch per key, so **only two or three
 * simultaneous keys are guaranteed**, which combinations fail depends on the grid layout of
 * that particular model, and our two seats already spend their guaranteed presses on a
 * direction and an action. Worse, the failure is *silent and undetectable from the browser* —
 * a blocked press simply never arrives — so a game could not even degrade gracefully when the
 * fingers it asked for did not come. Three fingers is not a hard thing to spell on a
 * keyboard; it is an impossible thing to spell reliably and an unknowable thing to spell
 * safely.
 *
 * Position is the fair multi-finger channel and always was: a radius, a sweep, a place on the
 * board are all things every family can name. A *count* is not. So a game that reads the
 * count is a game one input family cannot play, and the repository already has exactly one
 * honest answer for that — `sameInputClassOnly: true`, the way Road Dodge declares itself.
 *
 * The guard is deliberately the conservative direction. Reading the count requires the flag;
 * holding the flag requires nothing. A game may still declare itself same-class-only for any
 * of the reasons `docs/input-parity.md` lists and never touch a second finger.
 */

const GAMES_ROOT = join(__dirname, '../../../../packages/games');

/**
 * A *read* of the count, not a mention of it.
 *
 * Two files in the collection discuss `pointerCount` in prose — Money Grabber's manifest and
 * its game test both record that the number never left `input.ts`, which is the finding this
 * whole guard descends from. Matching the bare word would fire on the very package that
 * documented the problem and correctly declares `sameInputClassOnly: false`. So comments and
 * strings come out first, and what is left has to look like a property being taken:
 * `input.seat(s).pointerCount`, or the destructuring spelling of the same thing.
 */
const READS_COUNT = /\.\s*pointerCount\b|\{[^{}]*\bpointerCount\b[^{}]*\}\s*=/;

/**
 * Strip comments and string literals from TypeScript source.
 *
 * Crude by design — it is a lexer for one question ("is this token live code?") and not a
 * parser. It walks the text once, so a `//` inside a string and a quote inside a comment both
 * come out right, which a set of independent regexes does not manage.
 */
function stripInert(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i += 1;
      while (i < source.length && source[i] !== ch) i += source[i] === '\\' ? 2 : 1;
      i += 1;
      out += ' ';
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Every shipped `.ts` under a game's `src`. Tests are excluded: none of them reaches a player. */
function shippedSources(gameDir: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(full);
    }
  };
  walk(join(gameDir, 'src'));
  return files;
}

function gameSlugs(): string[] {
  return readdirSync(GAMES_ROOT)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => {
      try {
        return statSync(join(GAMES_ROOT, name, 'src')).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

/** Whether a game's manifest declares itself same-input-class only. */
function declaresSameClassOnly(gameDir: string): boolean {
  for (const file of shippedSources(gameDir)) {
    if (!file.endsWith('manifest.ts')) continue;
    if (/sameInputClassOnly\s*:\s*true/.test(stripInert(readFileSync(file, 'utf8')))) return true;
  }
  return false;
}

describe('the finger count and sameInputClassOnly', () => {
  it('is read by no game that has not declared itself same-input-class only', () => {
    const offenders: string[] = [];
    for (const slug of gameSlugs()) {
      const dir = join(GAMES_ROOT, slug);
      const readers = shippedSources(dir).filter((file) =>
        READS_COUNT.test(stripInert(readFileSync(file, 'utf8'))),
      );
      if (readers.length > 0 && !declaresSameClassOnly(dir)) {
        offenders.push(`${slug} (${readers.map((f) => f.slice(dir.length + 1)).join(', ')})`);
      }
    }
    expect(
      offenders,
      [
        'These games read SeatInputView.pointerCount without declaring sameInputClassOnly: true.',
        'A finger count has no keyboard equivalent and cannot be given one — see',
        'docs/keyboard-rollover.md. Either set the flag in the manifest and say why in the',
        'SPEC, or express the mechanic through position, which every input family can name.',
        offenders.join('\n  '),
      ].join('\n'),
    ).toEqual([]);
  });

  /**
   * The guard passes vacuously today: no game reads the count yet, because the field is one
   * commit old. CLAUDE.md is blunt about what that is worth — "a guard nobody has seen fail
   * is a guard nobody has seen", and five of the six unexecuted guards found in a single day
   * looked exactly this healthy. So the predicate is driven over sources that do not exist,
   * and watched to fail on purpose.
   */
  it('fires on a read and stays quiet on a mention', () => {
    const reads = [
      'if (input.seat(seat).pointerCount > 1) grip();',
      'const { pointerCount } = view.seat("p1");',
      'const n = state.seat(active) .pointerCount;',
    ];
    for (const source of reads) {
      expect(READS_COUNT.test(stripInert(source)), source).toBe(true);
    }

    const mentions = [
      // Money Grabber's manifest and game test, near enough verbatim. Both must stay quiet.
      '// carries a single nullable pointer per seat and `pointerCount` never leaves input.ts',
      '/* SeatInputView carries one nullable pointer, and .pointerCount never leaves. */',
      'const why = "pointerCount is not exposed";',
      'const label = `reads .pointerCount`;',
      // A different property that merely ends the same way.
      'const n = hand.fingerPointerCounted;',
    ];
    for (const source of mentions) {
      expect(READS_COUNT.test(stripInert(source)), source).toBe(false);
    }
  });

  /**
   * The other half of the trap, and the half a regex cannot see.
   *
   * Money Grabber is the catalogue's only multi-touch row and the package that measured the
   * problem, so it is the one game whose answer is worth pinning: it expresses "all the
   * fingers" as a grab radius and stays cross-device fair. If somebody later rewrites it to
   * read the count, the guard above will make them declare the flag — and this makes them
   * notice that doing so takes the game away from every keyboard and trackpad player.
   */
  it('leaves Money Grabber playable by every input family', () => {
    const dir = join(GAMES_ROOT, 'money-grabber');
    expect(declaresSameClassOnly(dir), 'money-grabber is fair cross-device by construction').toBe(
      false,
    );
    const readers = shippedSources(dir).filter((file) =>
      READS_COUNT.test(stripInert(readFileSync(file, 'utf8'))),
    );
    expect(readers, 'and therefore must not read the count').toEqual([]);
  });
});
