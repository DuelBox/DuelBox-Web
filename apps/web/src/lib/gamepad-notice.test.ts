import { describe, expect, it } from 'vitest';
import { gamepadNotice } from './gamepad-notice';

const names = { p1: 'Ada', p2: 'Kim' } as const;

describe('what the pause panel says about a controller', () => {
  it('names whose seat a new pad will drive', () => {
    expect(gamepadNotice({}, { kind: 'connected', seat: 'p2', gamepadIndex: 1, id: 'x' }, names)).toBe(
      "A controller was plugged in. It will drive Kim's seat.",
    );
  });

  it('says a pad with no free seat drives nobody, and how to change that', () => {
    const text = gamepadNotice({}, { kind: 'connected', seat: null, gamepadIndex: 2, id: 'x' }, names);
    expect(text).toMatch(/both seats already have one/);
    expect(text).toMatch(/swap/i);
  });

  it('tells the player whose pad went dead that their seat still works', () => {
    const text = gamepadNotice({}, { kind: 'disconnected', seat: 'p1', gamepadIndex: 0, id: 'x' },
      names,
    );
    expect(text).toMatch(/^Ada's controller was unplugged/);
    expect(text).toMatch(/keyboard and touch/);
  });

  it('never names a seat by its id', () => {
    for (const kind of ['connected', 'disconnected', 'reassigned'] as const) {
      for (const seat of ['p1', 'p2', null] as const) {
        expect(gamepadNotice({}, { kind, seat, gamepadIndex: 0, id: 'x' }, names)).not.toMatch(
          /\bp[12]\b/,
        );
      }
    }
  });
});
