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
 */

const ROOT = join(__dirname, '../../../..');

/** `- id: x` blocks in `data/catalog.yaml`, reduced to the two scalars this file needs.
 *  Hand-rolled because there is no YAML parser in the workspace's dependencies and pulling one
 *  in to read two flat keys would cost more than it is worth. */
function catalogConfidence(): Map<string, string> {
  const source = readFileSync(join(ROOT, 'data/catalog.yaml'), 'utf8');
  const found = new Map<string, string>();
  let id: string | undefined;
  for (const line of source.split('\n')) {
    const start = /^- id:\s*(\S+)\s*$/.exec(line);
    if (start?.[1] !== undefined) {
      id = start[1];
      continue;
    }
    const confidence = /^\s{2}confidence:\s*(\S+)\s*$/.exec(line);
    if (confidence?.[1] !== undefined && id !== undefined) found.set(id, confidence[1]);
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

const collapse = (value: string) => value.split(/\s+/).filter(Boolean).join(' ');

describe('research provenance', () => {
  const confidence = catalogConfidence();
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

  it('records the reference rule text verbatim for every observed game', () => {
    const rows = observedRows();
    const wrong = observed
      .map((entry) => {
        const row = rows.get(entry.name);
        if (row === undefined) return `${entry.id}: no row in observed-rules.md`;
        if (collapse(row.rule) !== collapse(entry.rule))
          return `${entry.id}: rule text differs from the transcription`;
        return undefined;
      })
      .filter((problem) => problem !== undefined);
    expect(
      wrong,
      'the catalogue and the observation record disagree, so one of them is no longer what was ' +
        `seen on the screen: ${wrong.join('; ')}`,
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
