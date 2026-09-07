import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countdownViews } from './countdown-views';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(join(here, name), 'utf8');

describe('countdownViews (#142)', () => {
  it('draws the count twice in shared-screen: the local seat upright, the far seat turned', () => {
    const views = countdownViews('shared-screen', 'p1');
    expect(views).toHaveLength(2);
    // The local (near) seat is first and upright; the far seat is turned to face them.
    expect(views[0]).toEqual({ seat: 'p1', rotated: false });
    expect(views[1]).toEqual({ seat: 'p2', rotated: true });
  });

  it('turns the copy for whichever seat is at the far side', () => {
    const views = countdownViews('shared-screen', 'p2');
    expect(views[0]).toEqual({ seat: 'p2', rotated: false });
    expect(views[1]).toEqual({ seat: 'p1', rotated: true });
  });

  it('draws it once and upright in single-seat', () => {
    const views = countdownViews('single-seat', 'p1');
    expect(views).toHaveLength(1);
    expect(views[0]).toEqual({ seat: 'p1', rotated: false });
  });

  it('never turns a copy in single-seat, whichever seat is local', () => {
    expect(countdownViews('single-seat', 'p2')).toEqual([{ seat: 'p2', rotated: false }]);
  });
});

describe('the countdown is wired to render per-seat', () => {
  it('MatchOverlay draws a copy per countdownView and turns the far one', () => {
    const source = read('MatchOverlay.tsx');
    expect(source).toContain('countdownViews');
    expect(source).toMatch(/countFar/);
  });

  it('the far copy is turned with the rotate-180 pattern and is aria-hidden', () => {
    const css = read('MatchOverlay.module.css');
    // The turned copy uses the same rotate(180deg) the flipped scoreboard uses.
    expect(css).toMatch(/\.countFar\s*\{[^}]*rotate\(180deg\)/s);
    const source = read('MatchOverlay.tsx');
    // The turned copy must not be announced, or a screen reader hears the count twice.
    expect(source).toContain("'aria-hidden': true");
  });
});
