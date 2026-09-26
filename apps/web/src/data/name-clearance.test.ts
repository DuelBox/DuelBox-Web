import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Run the build's real entry point against disposable catalogues. A count-only ceiling
 * accepted a newly copied name whenever another pending decision was resolved (#2515).
 * The swap below keeps the count identical, so lowering that ceiling cannot fix the test.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const script = join(root, 'scripts', 'check-game-names.mjs');
const temporary: string[] = [];

interface Fixture {
  games: { id: string; name: string; refName: string }[];
  decisions: Record<string, { status: string; why: string }>;
  pending: string[];
  identical: string[];
  shipped: string;
}

function fixture(): Fixture {
  return {
    games: [
      { id: 'pending-game', name: 'Reference One', refName: 'Reference One' },
      { id: 'renamed-game', name: 'Our Name', refName: 'Reference Two' },
      { id: 'generic-game', name: 'Chess', refName: 'Chess' },
      { id: 'original-game', name: 'Original Game', refName: '' },
    ],
    decisions: {
      'pending-game': { status: 'pending', why: 'An unresolved fixture decision.' },
      'renamed-game': { status: 'renamed', why: 'Renamed away from "Reference Two".' },
      'generic-game': { status: 'generic', why: 'Chess is the ordinary name of the game.' },
      'original-game': { status: 'original', why: 'There is no reference game.' },
    },
    pending: ['pending-game'],
    // Both games whose name IS the reference name, whatever their decision says. The guard
    // freezes this set by identity, so `generic-game` is in it exactly as `pending-game` is.
    identical: ['pending-game', 'generic-game'],
    shipped: 'export const CATALOGUE = [];',
  };
}

function runFixture(input: Fixture) {
  const dir = mkdtempSync(join(tmpdir(), 'duelbox-name-clearance-'));
  temporary.push(dir);
  for (const path of ['scripts', 'data', 'apps/web/src/data']) {
    mkdirSync(join(dir, path), { recursive: true });
  }
  const copy = join(dir, 'scripts', 'check-game-names.mjs');
  copyFileSync(script, copy);
  writeFileSync(join(dir, 'data/catalog.generated.json'), JSON.stringify({ games: input.games }));
  writeFileSync(
    join(dir, 'data/name-clearance.json'),
    JSON.stringify({ games: input.decisions }),
  );
  writeFileSync(
    join(dir, 'data/name-clearance-pending.json'),
    JSON.stringify({ pending: input.pending, identical: input.identical }),
  );
  writeFileSync(join(dir, 'apps/web/src/data/catalogue.generated.ts'), input.shipped);
  return spawnSync(process.execPath, [copy], { encoding: 'utf8' });
}

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the name-clearance build guard', () => {
  it('accepts the current catalogue and its explicit pending baseline', () => {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  });

  it('accepts each recorded decision without claiming trademark clearance', () => {
    const result = runFixture(fixture());
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('3 non-pending name decisions, 1 pending');
    expect(result.stdout).not.toContain('cleared');
  });

  it('refuses a new pending name even below the former count ceiling', () => {
    const input = fixture();
    input.games.push({ id: 'new-game', name: 'Another Reference', refName: 'Another Reference' });
    input.decisions['new-game'] = { status: 'pending', why: 'A new copied fixture name.' };
    const result = runFixture(input);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('new-game — newly pending');
  });

  it('refuses exchanging a resolved name for a newly pending one at the same count', () => {
    const input = fixture();
    input.games[0]!.name = 'Our Replacement';
    input.decisions['pending-game']!.status = 'renamed';
    input.pending = [];
    input.games[1]!.name = 'Reference Two';
    input.decisions['renamed-game']!.status = 'pending';
    const result = runFixture(input);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('renamed-game — newly pending');
  });

  it('requires a resolved decision to leave the pending baseline in the same change', () => {
    const input = fixture();
    input.games[0]!.name = 'Our Replacement';
    input.decisions['pending-game'] = {
      status: 'renamed',
      why: 'Renamed away from "Reference One".',
    };
    const stale = runFixture(input);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain('pending-game — in the pending baseline but no longer pending');

    // Leaving `pending` is no longer enough on its own: the game has also stopped being one of
    // those that take their reference name, and the identity baseline has to say so too.
    input.pending = [];
    const halfDone = runFixture(input);
    expect(halfDone.status).toBe(1);
    expect(halfDone.stderr).toContain('pending-game — recorded as taking its reference name');

    input.identical = ['generic-game'];
    const resolved = runFixture(input);
    expect(resolved.status, resolved.stderr).toBe(0);

    input.games[0]!.name = 'Reference One';
    input.decisions['pending-game'] = { status: 'pending', why: 'Back to the reference name.' };
    input.identical = ['pending-game', 'generic-game'];
    const reverted = runFixture(input);
    expect(reverted.status).toBe(1);
    expect(reverted.stderr).toContain('pending-game — newly pending');
  });

  it('refuses duplicate baseline exceptions', () => {
    const input = fixture();
    input.pending.push('pending-game');
    const result = runFixture(input);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('repeats a game id');
  });

  it('still refuses a recorded rename that only changes case or punctuation', () => {
    const input = fixture();
    input.games[1]!.name = 'REFERENCE-two!';
    const result = runFixture(input);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('renamed-game — recorded as renamed');
  });

  it('still requires a written reason for a pending exception', () => {
    const input = fixture();
    input.decisions['pending-game']!.why = '  ';
    const result = runFixture(input);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('pending-game — status "pending" with no reason');
  });

  it('still refuses a decision for a game absent from the catalogue', () => {
    const input = fixture();
    input.decisions['deleted-game'] = { status: 'renamed', why: 'A stale decision.' };
    const result = runFixture(input);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('deleted-game — recorded here but not in the catalogue');
  });

  it('still refuses reference-name fields in the browser catalogue', () => {
    const input = fixture();
    input.shipped = 'export const CATALOGUE = [{ refName: "Reference One" }];';
    const result = runFixture(input);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('carries a refName field');
  });

  it('refuses a new copied name that calls itself generic, not only one that admits to pending', () => {
    // The hole this baseline was widened to close. The previous ratchet was keyed on the word
    // `pending`, and the word is chosen by whoever adds the game — so the same copied name
    // sailed through the moment its decision said `generic`. Reproduced against the shipped
    // catalogue before the fix: a game with name and refName both "Shadow Clone" and a one-line
    // generic decision exited 0 at "109 games".
    const input = fixture();
    input.games.push({ id: 'copied-game', name: 'Shadow Clone', refName: 'Shadow Clone' });
    input.decisions['copied-game'] = { status: 'generic', why: 'Shadow Clone is ordinary.' };
    const result = runFixture(input);
    expect(result.status, result.stdout).toBe(1);
    expect(result.stderr).toContain('copied-game — its name is the reference name');
  });

  it('requires a renamed game to leave the identical baseline in the same change', () => {
    const input = fixture();
    input.games[2] = { id: 'generic-game', name: 'Our Own Board', refName: 'Chess' };
    input.decisions['generic-game'] = { status: 'renamed', why: 'Renamed away from "Chess".' };
    const result = runFixture(input);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('generic-game — recorded as taking its reference name');
  });

  it('accepts a rename that updates the decision and the baseline together', () => {
    // The control: the check has to let the work through, or it is a ratchet that forbids
    // progress rather than regression.
    const input = fixture();
    input.games[2] = { id: 'generic-game', name: 'Our Own Board', refName: 'Chess' };
    input.decisions['generic-game'] = { status: 'renamed', why: 'Renamed away from "Chess".' };
    input.identical = ['pending-game'];
    const result = runFixture(input);
    expect(result.status, result.stderr).toBe(0);
  });

  it('refuses duplicate ids in the identical baseline', () => {
    const input = fixture();
    input.identical = ['pending-game', 'generic-game', 'generic-game'];
    const result = runFixture(input);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('repeats a game id in "identical"');
  });

  it('refuses a decision whose reason never names what it is about', () => {
    // `why: "x"` satisfies a presence check, and so does one sentence pasted onto every row.
    // What this catches is drift: a reference name corrected in the catalogue while the
    // justification goes on arguing about the name the game used to have.
    const input = fixture();
    input.decisions['renamed-game'] = { status: 'renamed', why: 'A different name was chosen.' };
    const result = runFixture(input);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('never quotes the reference name "Reference Two"');

    const generic = fixture();
    generic.decisions['generic-game'] = { status: 'generic', why: 'It is an ordinary name.' };
    const second = runFixture(generic);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain('never quotes "Chess"');
  });
});
