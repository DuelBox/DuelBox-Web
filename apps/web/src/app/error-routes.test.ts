import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The two failure routes exist, share one visual language, and send nothing off-device.
 *
 * Before #92 both a wrong address and a thrown route landed on Next's built-in default —
 * black Helvetica, no header, no footer, no way onward. They are now one panel used twice,
 * on purpose: two different failures should not teach a player two different visual
 * languages for "something went wrong".
 */
const app = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(join(app, name), 'utf8');

describe('the failure routes', () => {
  it('both exist and share the panel', () => {
    for (const file of ['not-found.tsx', 'error.tsx']) {
      const source = read(file);
      expect(source, `${file} does not use the shared panel`).toContain('not-found.module.css');
      expect(source, `${file} offers no way onward`).toContain('/games/');
    }
  });

  it('recovers in place rather than by reloading', () => {
    // `reset()` is what makes the boundary a boundary: Next re-renders the segment, so a
    // chunk that failed to arrive costs a press rather than a full reload. A page that only
    // linked away would satisfy "styled" and fail "recovers".
    const source = read('error.tsx');
    expect(source).toMatch(/reset\s*\(\)/);
    expect(source, 'an error boundary must be a client component').toContain("'use client'");
  });

  it('reports nothing off this device', () => {
    // #92 asks for error tracking. This product refuses it and says so on its own privacy
    // page — no analytics, no cookies, no server — the CSP's connect-src is 'self', and
    // check-zero-cost fails the build on a beacon. The digest shown to the player is the
    // honest substitute: quotable, and collected by nobody.
    const source = read('error.tsx');
    expect(source, 'the error boundary must not phone home').not.toMatch(
      /fetch\(|sendBeacon|XMLHttpRequest|new WebSocket/,
    );
  });
});
