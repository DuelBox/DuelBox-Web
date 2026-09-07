import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SOUND_EVENTS } from '@duelbox/engine';
import {
  armAudio,
  audio,
  emitCue,
  resetAudioForTest,
  setSoundMuted,
  setSoundVolume,
  soundBus,
  soundPreference,
} from './audio';

/**
 * The shell's audio wiring, checked in the runtime it has to survive: **Node, with no
 * `AudioContext`, no `document` and no gesture to make.**
 *
 * That is not a contrivance. This site is a static export, so every module the play page
 * imports is evaluated on the build machine, and a module that reaches for `window` or
 * `AudioContext` at import or on first call takes the whole build with it. Everything here
 * therefore has to be a no-op rather than an error when there is nothing to play through.
 */

const scope = globalThis as unknown as {
  localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void };
};
const originalStorage = scope.localStorage;

beforeEach(() => {
  const store = new Map<string, string>();
  scope.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
  resetAudioForTest();
});

afterEach(() => {
  resetAudioForTest();
  if (originalStorage === undefined) delete scope.localStorage;
  else scope.localStorage = originalStorage;
});

describe('the shell audio system', () => {
  it('is one per tab, and so is the bus', () => {
    // Two systems would each ask for their own permission, and the autoplay policy is
    // granted per document — so one would unlock and the other would be silently suspended.
    expect(audio()).toBe(audio());
    expect(soundBus()).toBe(soundBus());
  });

  it('arms and emits without a browser, rather than throwing', () => {
    expect(() => {
      armAudio();
    }).not.toThrow();
    for (const event of SOUND_EVENTS) {
      expect(() => {
        emitCue(event);
      }).not.toThrow();
    }
    // No context here, so nothing is heard and nothing is queued against one either.
    expect(() => {
      audio().flush();
    }).not.toThrow();
  });

  it('is idempotent, because the play page arms it on every mount', () => {
    armAudio();
    armAudio();
    armAudio();
    expect(audio().armed).toBe(false); // no `document` to attach listeners to
    expect(audio().unlocked).toBe(false);
  });

  it('applies a stored mute to the system and remembers it', () => {
    expect(setSoundMuted(true)).toBe(true);
    expect(audio().muted).toBe(true);
    expect(soundPreference().muted).toBe(true);
    expect(setSoundMuted(false)).toBe(false);
    expect(audio().muted).toBe(false);
  });

  it('applies a level, clamps it, and keeps it through a mute', () => {
    expect(setSoundVolume(0.3)).toBe(0.3);
    expect(audio().masterGain).toBe(0.3);
    expect(setSoundVolume(9)).toBe(1);
    setSoundMuted(true);
    // The level a mute is hiding is still the level, so unmuting restores what was chosen.
    expect(audio().masterGain).toBe(1);
    expect(soundPreference().volume).toBe(1);
  });

  it('starts a fresh system from what was stored', () => {
    setSoundMuted(true);
    setSoundVolume(0.2);
    resetAudioForTest();
    expect(audio().muted).toBe(true);
    expect(audio().masterGain).toBe(0.2);
  });
});
