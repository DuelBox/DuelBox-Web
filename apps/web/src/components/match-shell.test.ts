import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Source-level checks for the shell-chrome wiring that has no DOM-free seam of its own:
 * the pause menu's new options (#145), the HUD clock (#149) and the game error boundary
 * (#151). The behaviour these guard lives in `.tsx` a node test cannot render, so they
 * assert the wiring is present — each was checked by breaking the wiring and watching it fail.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(join(here, name), 'utf8');

describe('the pause menu (#145)', () => {
  const overlay = read('MatchOverlay.tsx');

  it('offers Restart and Settings alongside Resume and Quit', () => {
    // All four options are in the paused panel.
    expect(overlay).toMatch(/Resume/);
    expect(overlay).toContain('onClick={onRestart}');
    expect(overlay).toMatch(/>\s*Restart\s*</);
    expect(overlay).toContain('href="/settings/"');
    expect(overlay).toMatch(/Quit match/);
  });

  it('the play surface restarts the match cleanly', () => {
    const surface = read('PlaySurface.tsx');
    // Restart quits to idle then starts a fresh match with a new seed.
    expect(surface).toMatch(/const restart = useCallback/);
    expect(surface).toContain("send({ kind: 'quit' });");
    expect(surface).toContain("send({ kind: 'start', seed: next });");
    expect(surface).toContain('onRestart={restart}');
  });
});

describe('the HUD clock (#149)', () => {
  it('the HUD shows the clock the SDK drives', () => {
    const hud = read('MatchHud.tsx');
    // The clock element is rendered when a formatted clock is passed, with the near-expiry
    // flag bound to the actual attribute — assert the JSX, not a substring a comment satisfies.
    expect(hud).toContain('clock === undefined ? null');
    expect(hud).toMatch(/data-warning=\{clockWarning \?/);
    // The near-expiry state changes weight, not only colour (rule 7).
    const css = read('MatchHud.module.css');
    expect(css).toMatch(/\.clock\[data-warning='true'\]/);
  });

  it('the play surface advances the clock on the fixed step and fires expiry', () => {
    const surface = read('PlaySurface.tsx');
    expect(surface).toContain('advanceClock');
    expect(surface).toContain('clockExpired');
    // Expiry reports the tally with timeExpired, which the win condition resolves.
    expect(surface).toContain('timeExpired: true');
  });
});

describe('the game error boundary (#151)', () => {
  it('the host guards game callbacks and stops the loop on a throw', () => {
    const host = read('GameHost.tsx');
    expect(host).toContain('guard(');
    // On a crash the runner is stopped and the error reported up.
    expect(host).toContain('runnerRef.current?.stop()');
    expect(host).toContain('onErrorRef.current?.(error)');
    // Further stepping is skipped once crashed.
    expect(host).toContain('if (crashed) return;');
  });

  it('the surface wraps the host in the boundary and shows a recovery screen', () => {
    const surface = read('PlaySurface.tsx');
    expect(surface).toContain('<GameErrorBoundary');
    expect(surface).toContain('externalError={gameError}');
    expect(surface).toContain('onError={handleGameError}');
    const boundary = read('GameErrorBoundary.tsx');
    // Recovery offers Restart and Quit.
    expect(boundary).toMatch(/Restart/);
    expect(boundary).toMatch(/Quit match/);
    expect(boundary).toContain('getDerivedStateFromError');
  });
});

describe('changing a match between rounds (#2351)', () => {
  it('the play surface asks one rule what may change and hands the overlay the answer', () => {
    const surface = read('PlaySurface.tsx');
    expect(surface).toContain('describeChanges({');
    expect(surface).toContain('onHandSeat: handSeat');
    expect(surface).toContain('onRounds: chooseRounds');
    // A hand-over keeps the match machine out of it, so the round tally stays put — and marks
    // the match as one that belongs on no record.
    expect(surface).toMatch(/const handSeat = useCallback/);
    expect(surface).toContain('setMixed(true)');
    expect(surface).toContain('unrecorded={mixed}');
  });

  it('the overlay offers the change between rounds and gives the reason on pause', () => {
    const overlay = read('MatchOverlay.tsx');
    expect(overlay).toContain('Change something for the next round');
    expect(overlay).toContain('{changing.changes.seat.reason}');
    // Every refusal is shown, once, and the device one always: nothing is refused silently.
    expect(overlay).toContain('{changes.device.reason}');
    expect(overlay).toContain('Not added to the record');
  });

  it('the tournament carries its tier into the lobby, the track and the HUD (#2347)', () => {
    const surface = read('PlaySurface.tsx');
    expect(surface).toContain('difficulty: setup.difficulty');
    expect(surface).toContain('tier={tournament.difficulty}');
    expect(read('TournamentTrack.tsx')).toContain('Bot skill: {tier}');
    expect(read('MatchHud.tsx')).toContain('{tierLabel}');
  });
});
