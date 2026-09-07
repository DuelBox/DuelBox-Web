import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameManifest } from '@duelbox/game-sdk';
import { handoffEnabled, handoffPrompt, shouldHandOff } from './handoff';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(join(here, name), 'utf8');

const optedIn = { handoff: true } as Pick<GameManifest, 'handoff'>;
const notOptedIn = { handoff: undefined } as Pick<GameManifest, 'handoff'>;

describe('handoff gating (#134)', () => {
  it('is enabled only when the manifest opts in', () => {
    expect(handoffEnabled(optedIn)).toBe(true);
    expect(handoffEnabled(notOptedIn)).toBe(false);
    expect(handoffEnabled({} as Pick<GameManifest, 'handoff'>)).toBe(false);
  });

  it('blacks out only for an opted-in game changing hands', () => {
    // A game that did not opt in never blacks out, whatever the seats do.
    expect(shouldHandOff(notOptedIn, 'p1', 'p2')).toBe(false);
    // An opted-in game blacks out on a real change of hands.
    expect(shouldHandOff(optedIn, 'p1', 'p2')).toBe(true);
    expect(shouldHandOff(optedIn, 'p2', 'p1')).toBe(true);
  });

  it('does not black out on the first seat or on no change', () => {
    // The first active seat of a match is nobody handing over.
    expect(shouldHandOff(optedIn, null, 'p1')).toBe(false);
    // A game re-reporting the same seat is not a hand-off.
    expect(shouldHandOff(optedIn, 'p1', 'p1')).toBe(false);
    // A game clearing its active seat is not one either.
    expect(shouldHandOff(optedIn, 'p1', null)).toBe(false);
  });

  it('names the incoming player in the prompt', () => {
    expect(handoffPrompt('Bo')).toBe('Pass to Bo');
  });
});

describe('the blackout overlay', () => {
  it('is a full opaque cover, so no frame of the other seat leaks through', () => {
    const css = read('HandoffOverlay.module.css');
    // Solid ink, not the translucent colour-mix the pause overlay uses.
    expect(css).toMatch(/\.blackout\s*\{[^}]*background:\s*var\(--db-ink\)/s);
    expect(css).not.toContain('color-mix');
    // And insets from the cutout with max().
    expect(css).toContain('max(var(--db-space-4), var(--db-safe-top))');
  });

  it('is only rendered when a hand-off is due', () => {
    // The play surface gates it on the handoffTo state, which is only set through shouldHandOff.
    const surface = read('PlaySurface.tsx');
    expect(surface).toContain('handoffTo !== null');
    expect(surface).toContain('shouldHandOff');
  });
});
