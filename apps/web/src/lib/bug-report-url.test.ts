import { afterEach, describe, expect, it } from 'vitest';
import {
  BUG_REPORT_FORM,
  bugReportUrl,
  readBugReportEnvironment,
  type BugReportContext,
  type BugReportMatch,
} from './bug-report-url';

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';

const match: BugReportMatch = {
  game: 'Ping Pong',
  mode: 'bot',
  difficulty: 'normal',
  presentation: 'shared-screen',
  rounds: 3,
  state: {
    phase: 'paused',
    round: 2,
    roundWins: { p1: 1, p2: 0 },
    tally: { p1: 4, p2: 7 },
    seed: 12345,
  },
};

const full: BugReportContext = {
  slug: 'ping-pong',
  device: UA,
  viewport: { width: 393, height: 852 },
  orientation: 'portrait',
  match,
};

const fields = (url: string) => new URL(url).searchParams;

describe('the bug report link (#233)', () => {
  it('lands on the bug template with the game named, and nothing else when nothing is known', () => {
    expect(bugReportUrl({ slug: 'ping-pong' })).toBe(
      `${BUG_REPORT_FORM}?template=bug.yml&game=ping-pong`,
    );
  });

  it('carries the device verbatim, the viewport, and the opening steps', () => {
    const params = fields(bugReportUrl(full));
    expect(params.get('template')).toBe('bug.yml');
    expect(params.get('game')).toBe('ping-pong');
    // Verbatim: nothing in the user-agent string is parsed, and nothing in it is lost.
    expect(params.get('device')).toBe(UA);
    expect(params.get('size')).toBe('393x852, portrait');
    const steps = params.get('steps') ?? '';
    expect(steps.startsWith('1. Open /play/ping-pong/')).toBe(true);
    expect(steps).toContain('Start Ping Pong: against the bot on normal, best of 3, shared-screen');
    expect(steps).toContain('round 2 of 3');
    expect(steps).toContain('rounds 1-0');
    expect(steps).toContain('score 4-7');
    expect(steps).toContain('paused; seed 12345');
    // The form's field order in the placeholder: the reporter picks up at the fourth line.
    expect(steps.endsWith('\n4. ')).toBe(true);
  });

  it('describes the other two modes without a difficulty', () => {
    const friend = fields(bugReportUrl({ ...full, match: { ...match, mode: 'friend' } }));
    expect(friend.get('steps')).toContain('two players on this device');
    expect(friend.get('steps')).not.toContain('normal');
    const solo = fields(bugReportUrl({ ...full, match: { ...match, mode: 'solo' } }));
    expect(solo.get('steps')).toContain('Start Ping Pong: solo,');
  });

  it('omits what it was not given rather than writing "undefined"', () => {
    const params = fields(bugReportUrl({ slug: 'shell', viewport: { width: 1280, height: 720 } }));
    expect(params.has('device')).toBe(false);
    expect(params.has('steps')).toBe(false);
    expect(params.get('size')).toBe('1280x720');
    expect(bugReportUrl({ slug: 'shell' })).not.toContain('undefined');
  });

  it('never sets a label: bug.yml applies the triage label itself', () => {
    expect(fields(bugReportUrl(full)).has('labels')).toBe(false);
  });

  it('is deterministic', () => {
    expect(bugReportUrl(full)).toBe(bugReportUrl(full));
  });

  it('clips the user agent, the one unbounded field, and keeps everything else', () => {
    const params = fields(bugReportUrl({ ...full, device: 'x'.repeat(5000) }));
    expect((params.get('device') ?? '').length).toBe(256);
    expect(params.get('game')).toBe('ping-pong');
    expect(params.has('steps')).toBe(true);
    expect(params.get('template')).toBe('bug.yml');
  });

  it('carries no player name, whatever is passed around it', () => {
    // The builder has no field for one, which is the whole of the guarantee; this pins it.
    const url = bugReportUrl({ ...full, match: { ...match, game: 'Ping Pong' } });
    expect(url).not.toContain('Fox');
    expect(Object.keys(full)).not.toContain('seatNames');
  });
});

describe('reading the environment', () => {
  const globals = globalThis as Record<string, unknown>;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    if (!saved.has(name)) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  afterEach(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globals[name];
    }
    saved.clear();
  });

  it('never throws, and reports no viewport where there is no window', () => {
    install('innerWidth', undefined);
    install('innerHeight', undefined);
    const read = readBugReportEnvironment();
    expect(read.viewport).toBeUndefined();
    expect(read.orientation).toBeUndefined();
  });

  it('reads the user agent, the viewport, and the orientation the media query gives', () => {
    install('navigator', { userAgent: UA });
    install('innerWidth', 852);
    install('innerHeight', 393);
    // The query disagrees with the geometry on purpose, so the test can tell which was read.
    install('matchMedia', () => ({ matches: true }));
    expect(readBugReportEnvironment()).toEqual({
      device: UA,
      viewport: { width: 852, height: 393 },
      orientation: 'portrait',
    });
  });

  it('falls back to the geometry when there is no media query, or it throws', () => {
    install('navigator', { userAgent: UA });
    install('innerWidth', 852);
    install('innerHeight', 393);
    install('matchMedia', undefined);
    expect(readBugReportEnvironment().orientation).toBe('landscape');
    install('matchMedia', () => {
      throw new Error('no media queries here');
    });
    expect(readBugReportEnvironment().orientation).toBe('landscape');
  });
});
