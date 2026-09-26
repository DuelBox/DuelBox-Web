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
      'renamed-game': { status: 'renamed', why: 'A different name was chosen.' },
      'generic-game': { status: 'generic', why: 'The ordinary name of the game.' },
      'original-game': { status: 'original', why: 'There is no reference game.' },
    },
    pending: ['pending-game'],
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
    JSON.stringify({ pending: input.pending }),
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
    input.decisions['pending-game']!.status = 'renamed';
    const stale = runFixture(input);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain('pending-game — in the pending baseline but no longer pending');

    input.pending = [];
    const resolved = runFixture(input);
    expect(resolved.status, resolved.stderr).toBe(0);

    input.games[0]!.name = 'Reference One';
    input.decisions['pending-game']!.status = 'pending';
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
});
