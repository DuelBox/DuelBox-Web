import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(join(here, name), 'utf8');

describe('the in-match exit control (#144)', () => {
  const tsx = read('ExitControl.tsx');
  const css = read('ExitControl.module.css');

  it('opening the control does not quit — it only asks', () => {
    // The persistent button calls onOpen; only the confirmation's own button calls onQuit,
    // so a single tap can never forfeit the match.
    expect(tsx).toContain('onClick={onOpen}');
    expect(tsx).toMatch(/onClick=\{onQuit\}/);
    // The confirmation warns about forfeiting.
    expect(tsx.toLowerCase()).toContain('forfeit');
  });

  it('defaults focus to the safe choice, so a keyboard confirm keeps playing', () => {
    expect(tsx).toContain('cancelRef.current?.focus');
    expect(tsx).toMatch(/Keep playing/);
  });

  it('is a real dialog with a focus trap and Escape-to-cancel', () => {
    expect(tsx).toContain('role="dialog"');
    expect(tsx).toContain('aria-modal="true"');
    expect(tsx).toMatch(/event\.key === 'Escape'/);
    expect(tsx).toContain("event.key !== 'Tab'");
  });

  it('is edge-anchored and clears the cutout and the home-indicator band', () => {
    // Anchored top-right, away from the bottom home-indicator, insetting with max().
    expect(css).toMatch(/\.exit\s*\{[\s\S]*?position:\s*absolute/);
    expect(css).toContain('top: max(var(--db-space-2), var(--db-safe-top))');
    expect(css).toContain('right: max(var(--db-space-2), var(--db-safe-right))');
  });

  it('is wired to a shortcut that is not a seat action key', () => {
    // Space is seat one's and Enter is seat two's; the play surface opens this on Shift+Escape,
    // which the host passes through. The exit is opened by the shift branch of the Escape key.
    const surface = read('PlaySurface.tsx');
    expect(surface).toContain('event.shiftKey');
    expect(surface).toContain('setExitOpen(true)');
    // It is only shown while the match is live.
    expect(surface).toContain('matchLive ?');
  });
});
