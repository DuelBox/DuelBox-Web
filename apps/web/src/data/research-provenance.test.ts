import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGUE } from './catalogue.generated';

/**
 * The repository may not claim research it has not done.
 *
 * `scripts/generate_catalog.py` used to emit a per-game `researched` boolean, documented as
 * "False when the game still has an open research issue" and computed as
 * `bool(game.get("rule"))`. Every game has a one-line rule blurb, so it was `true` for all 108
 * games while **107 of the 108 research issues were open and no game had a RESEARCH.md at all**
 * (#2514). Two things kept that invisible: the expression never tested what its comment claimed
 * to test, and its only reader — the home page's `featured` filter — filtered on it and removed
 * nothing, so the page looked identical either way.
 *
 * That is the seventh guard in this repository found asserting something nothing ran, and the
 * first one that could not be caught by running it and watching it fail, because nothing was
 * ever written to run. This is that thing. It is deliberately about provenance rather than
 * about the flag: the flag is gone, and what must not come back is any field claiming research
 * for a game that has none.
 *
 * `docs/research-status.md` is the prose version, and the last two tests keep it and
 * `docs/observed-rules.md` from going stale — the day somebody really plays the reference games
 * and writes the files, these fail and name the sentence to update.
 *
 * ## The rule text: this file used to assert the opposite, and the opposite was right
 *
 * Until #2513 item 7 the guard here read "records the reference rule text verbatim for every
 * observed game", and compared `catalog.yaml`'s `rule` against the transcription in
 * `docs/observed-rules.md` word for word. That was written when the two were the same string,
 * and it was enforcing a defect: all 108 catalogue rules *were* the reference app's own
 * pre-game copy, lightly paraphrased — 63 of them shouting, 47 naming a physical input, most
 * of those an input the game does not have — and they are the games' `<meta>` descriptions,
 * the sentence a search engine prints. CLAUDE.md rule 1 forbids copying text from another
 * product, so the strings were rewritten from each game's own `SPEC.md` and `manifest.ts`.
 * After that rewrite the old assertion could only be satisfied by putting the borrowed text
 * back, which is the one outcome nobody wants: **a guard whose cheapest repair is the defect
 * is pointed the wrong way round.**
 *
 * So it is turned around rather than deleted, because the two files still owe each other
 * something — just not sameness. What each one is for did not change:
 *
 * - `docs/observed-rules.md` is the **provenance record**: what was on the screen, which game
 *   it was on, transcribed while playing. It is evidence, and evidence may not quietly lose a
 *   row or gain one. That is the "keeps an observation on file" test below, and it checks
 *   coverage in *both* directions plus the reference name each row was observed from — the
 *   one field the catalogue and the record still share, and the only one that can go stale
 *   unnoticed now that the prose is independent.
 * - `data/catalog.yaml`'s `rule` is **ours**, and its obligation is the inverse of the old
 *   one: it must not be a copy. That is the "in our own words" test, and the thing it
 *   measures is the longest run of consecutive words the two texts share — see
 *   {@link LIFTED_RUN}.
 *
 * Neither of those can be satisfied by reverting the rewrite, and together they say more than
 * the equality check did: it could not tell a transcription from a lift of one, because under
 * it they were the same thing.
 */

const ROOT = join(__dirname, '../../../..');

/** One flat scalar out of every `- id: x` block in `data/catalog.yaml`, by game id.
 *  Hand-rolled because there is no YAML parser in the workspace's dependencies and pulling one
 *  in to read two flat keys would cost more than it is worth. Only keys indented exactly two
 *  spaces match, so the folded block scalars two `rule` values use cannot be read as one. */
function catalogScalar(key: 'confidence' | 'refName'): Map<string, string> {
  const source = readFileSync(join(ROOT, 'data/catalog.yaml'), 'utf8');
  const scalar = new RegExp(`^\\s{2}${key}:\\s*(.+?)\\s*$`);
  const found = new Map<string, string>();
  let id: string | undefined;
  for (const line of source.split('\n')) {
    const start = /^- id:\s*(\S+)\s*$/.exec(line);
    if (start?.[1] !== undefined) {
      id = start[1];
      continue;
    }
    const value = scalar.exec(line);
    if (value?.[1] !== undefined && id !== undefined) found.set(id, value[1]);
  }
  return found;
}

/** The rules table in `docs/observed-rules.md`, by our name for the game. Cells hold no pipes,
 *  so a row is complete once it has five of them; two rows wrap onto a second line and one of
 *  those has a blank line inside a cell. */
function observedRows(): Map<string, { reference: string; rule: string }> {
  const source = readFileSync(join(ROOT, 'docs/observed-rules.md'), 'utf8');
  const rows = new Map<string, { reference: string; rule: string }>();
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\|\s*\*\*/.test(lines[i] ?? '')) continue;
    let row = lines[i] ?? '';
    while (row.split('|').length < 7 && i + 1 < lines.length) {
      i += 1;
      row = `${row}\n${lines[i] ?? ''}`;
    }
    const cells = row.split('|').slice(1, -1);
    const name = /^\s*\*\*(.+?)\*\*\s*$/.exec(cells[0] ?? '')?.[1];
    if (name === undefined) continue;
    rows.set(name, { reference: (cells[1] ?? '').trim(), rule: (cells[4] ?? '').trim() });
  }
  return rows;
}

/** A text as the words it is made of: lowercased, punctuation dropped, runs of space closed
 *  up. Comparing this form rather than the raw string means neither a capital letter nor a
 *  removed exclamation mark can turn a copy into an original. */
const words = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);

/**
 * Consecutive words the catalogue rule and the transcription share, above which the rule is a
 * lift of the reference app's copy rather than a phrase two writers both reached for.
 *
 * The number is measured, not guessed, over all 107 observed games:
 *
 * | | longest shared run | pairs at 8 or more |
 * |---|---|---|
 * | before the rewrite | 6 to 48 words, all 107 identical | 104 of 107 |
 * | after it | 1 to 7 words, none identical | 0 of 107 |
 *
 * Eight is the first value nothing reaches from below and almost nothing misses from above,
 * so it separates the two populations with no judgement call in it. The single longest run
 * left is seven — `disco-battle`'s "at the end of the song wins", which is how anyone would
 * end that sentence — and the median is two.
 *
 * A run this long is the right thing to measure because a shared *vocabulary* is not evidence
 * of anything. Both texts describe the same mechanic and have to name its parts, so the pair
 * with the highest word overlap left — `backgammon`, at 40% — shares "checkers", "dice",
 * "bar", "home board" and "bear off", which is simply what backgammon's pieces are called.
 * Its longest run is five. Eight words in the same order is not a shared subject; it is a
 * shared sentence.
 *
 * If an honest rewrite ever trips this, the phrase named in the failure is the finding: say it
 * another way. Raising the number is not the repair — the gap it sits in is 7 against 48.
 */
const LIFTED_RUN = 8;

/**
 * The longest run of consecutive words two texts share, and the run itself.
 *
 * Longest common substring over word arrays rather than characters, so "wins the game" and
 * "wins the games" count as two words in common and not thirteen letters. One row of the
 * table at a time: the texts are a sentence long and the whole comparison is 107 of them.
 */
function longestSharedRun(left: string, right: string): { length: number; text: string } {
  const ours = words(left);
  const theirs = words(right);
  let best = 0;
  let endsAt = 0;
  let previous = new Array<number>(theirs.length + 1).fill(0);
  for (let i = 1; i <= ours.length; i += 1) {
    const row = new Array<number>(theirs.length + 1).fill(0);
    for (let j = 1; j <= theirs.length; j += 1) {
      if (ours[i - 1] !== theirs[j - 1]) continue;
      const run = (previous[j - 1] ?? 0) + 1;
      row[j] = run;
      if (run > best) {
        best = run;
        endsAt = i;
      }
    }
    previous = row;
  }
  return { length: best, text: ours.slice(endsAt - best, endsAt).join(' ') };
}

describe('research provenance', () => {
  const confidence = catalogScalar('confidence');
  const refNames = catalogScalar('refName');
  const observed = CATALOGUE.filter((entry) => confidence.get(entry.id) === 'observed');
  const withResearchFile = CATALOGUE.filter((entry) =>
    existsSync(join(ROOT, 'packages/games', entry.id, 'RESEARCH.md')),
  );

  it('reads a catalogue and a confidence for every game', () => {
    expect(CATALOGUE.length).toBeGreaterThan(0);
    expect(confidence.size).toBe(CATALOGUE.length);
    expect(observed.length).toBeGreaterThan(0);
  });

  it('claims research for no game that has no RESEARCH.md', () => {
    const researched = new Set(withResearchFile.map((entry) => entry.id));
    const claiming = CATALOGUE.filter((entry) => {
      const fields = Object.entries(entry as unknown as Record<string, unknown>);
      return fields.some(([key, value]) => /research/i.test(key) && value !== false);
    }).map((entry) => entry.id);
    const unsupported = claiming.filter((id) => !researched.has(id));
    expect(
      unsupported,
      'the catalogue asserts research provenance for games with no packages/games/<id>/RESEARCH.md: ' +
        `${unsupported.join(', ')}. A game is researched when somebody played the reference game and ` +
        'wrote down what they saw (CLAUDE.md rule 2), which is not something the catalogue can infer ' +
        'from its own contents. See docs/research-status.md.',
    ).toEqual([]);
  });

  /**
   * The provenance record covers the catalogue, exactly, and still names what was observed.
   *
   * Coverage in both directions, because both are ways of claiming something untrue. A game
   * marked `confidence: observed` with no row asserts an observation nothing recorded; a row
   * for a game the catalogue does not mark observed asserts we copied a reference app that was
   * never involved. `cricket` is the live case of the second — it is ours, it has no reference
   * game, and the header count would not notice a row appearing for it, because the count is
   * checked against `observed.length` and a stray row is not in that number.
   *
   * The reference name is the third thing, and the one that needs a guard now. It is the only
   * field the catalogue and the record still share: `refName` in `catalog.yaml` and the
   * "In reference app" column say which game was on the screen. Before #2513 item 7 a drifting
   * record was caught by the rule text; nothing else was watching this, and a renamed or
   * re-pointed row would now go through in silence — which is exactly how a research note ends
   * up filed under the wrong game.
   */
  it('keeps an observation on file for every observed game and for no other', () => {
    const rows = observedRows();
    const names = new Set(observed.map((entry) => entry.name));
    const missing = observed.filter((entry) => !rows.has(entry.name)).map((entry) => entry.id);
    expect(
      missing,
      'these games are marked `confidence: observed` and have no row in docs/observed-rules.md, ' +
        `so the catalogue claims an observation the record does not hold: ${missing.join(', ')}`,
    ).toEqual([]);

    const stray = [...rows.keys()].filter((name) => !names.has(name));
    expect(
      stray,
      'docs/observed-rules.md transcribes a reference screen for games the catalogue does not ' +
        `mark observed: ${stray.join(', ')}. An original game must never gain a row.`,
    ).toEqual([]);

    const wrong = observed
      .map((entry) => {
        const row = rows.get(entry.name);
        // The missing rows are the assertion above; do not report them twice.
        if (row === undefined) return undefined;
        const named = refNames.get(entry.id);
        if (named !== row.reference)
          return `${entry.id}: catalog.yaml was observed from "${named ?? 'nothing'}", the ` +
            `record from "${row.reference}"`;
        if (row.rule === '') return `${entry.id}: the transcription cell is empty`;
        return undefined;
      })
      .filter((problem) => problem !== undefined);
    expect(
      wrong,
      'the catalogue and the observation record no longer agree about which reference game was ' +
        `played, or the record has lost what was read off it: ${wrong.join('; ')}`,
    ).toEqual([]);
  });

  /**
   * And the catalogue rule is ours.
   *
   * This is the assertion that used to demand the opposite, turned around — see the top of the
   * file for why, in one line: the strings it was holding in place were the reference app's,
   * and CLAUDE.md rule 1 says they may not be. The transcription stays on file as evidence;
   * the catalogue describes the mechanic we built, in the voice `catalogue-voice.test.ts`
   * checks the shape of. That file asks whether the sentence reads like ours. This one asks the
   * question rule 1 actually poses, which is whether it is somebody else's.
   *
   * Two failures, and the second is why word-for-word equality is not enough on its own. A rule
   * that is the transcription is a copy however short it is — `checkers` transcribes to six
   * words, so a run threshold alone would let a verbatim lift of it through. A rule that shares
   * {@link LIFTED_RUN} words in a row with the transcription is a copy however much of the rest
   * has been reworded, which is the case the old equality check could not see at all: it went
   * green on 108 rows that were paraphrases of reference copy, because a paraphrase of a
   * transcription matches the transcription it was copied into.
   */
  it('describes every observed game in our own words, not the reference app\'s', () => {
    const rows = observedRows();
    const copied = observed
      .map((entry) => {
        const row = rows.get(entry.name);
        if (row === undefined) return undefined;
        if (words(row.rule).join(' ') === words(entry.rule).join(' '))
          return `${entry.id}: the catalogue rule is the transcription, word for word`;
        const shared = longestSharedRun(entry.rule, row.rule);
        if (shared.length >= LIFTED_RUN)
          return `${entry.id}: ${String(shared.length)} words in a row — "${shared.text}"`;
        return undefined;
      })
      .filter((problem) => problem !== undefined);
    expect(
      copied,
      'these catalogue rules are the reference app\'s own words rather than ours, which ' +
        `CLAUDE.md rule 1 forbids: ${copied.join('; ')}. The rule belongs to the game we built ` +
        '— write it from the SPEC.md and the manifest, not from the row above it.',
    ).toEqual([]);
  });

  it('states a coverage figure in observed-rules.md that matches the catalogue', () => {
    const source = readFileSync(join(ROOT, 'docs/observed-rules.md'), 'utf8');
    const claim = /\*\*Coverage:\s*(\d+)\s*of\s*(\d+)\s*games/.exec(source);
    expect(claim, 'docs/observed-rules.md no longer states a coverage figure').not.toBeNull();
    expect([Number(claim?.[1]), Number(claim?.[2])]).toEqual([observed.length, observed.length]);
  });

  it('states a research figure in research-status.md that matches what is on disk', () => {
    const source = readFileSync(join(ROOT, 'docs/research-status.md'), 'utf8');
    const claim = /\*\*(\d+) of the (\d+) reference-derived games have no `RESEARCH\.md`/.exec(
      source,
    );
    expect(claim, 'docs/research-status.md no longer states how many games lack a RESEARCH.md')
      .not.toBeNull();
    const missing = observed.filter(
      (entry) => !existsSync(join(ROOT, 'packages/games', entry.id, 'RESEARCH.md')),
    );
    expect(
      [Number(claim?.[1]), Number(claim?.[2])],
      'docs/research-status.md is stale. If research has actually been done, say so there and ' +
        'in the issues; if a game was added or removed, update the figure.',
    ).toEqual([missing.length, observed.length]);
  });
});
