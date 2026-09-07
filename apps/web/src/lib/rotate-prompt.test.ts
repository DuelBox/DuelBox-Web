import { describe, expect, it } from 'vitest';
import { orientationOf, shouldPromptRotate } from './rotate-prompt';

describe('orientationOf', () => {
  it('reads a wide viewport as landscape and a tall one as portrait', () => {
    expect(orientationOf(800, 400)).toBe('landscape');
    expect(orientationOf(400, 800)).toBe('portrait');
  });
  it('treats a square as portrait, consistently', () => {
    expect(orientationOf(500, 500)).toBe('portrait');
  });
});

describe('shouldPromptRotate (#136)', () => {
  it('never prompts a game that declares any orientation', () => {
    expect(shouldPromptRotate('any', 400, 800)).toBe(false);
    expect(shouldPromptRotate('any', 800, 400)).toBe(false);
  });

  it('prompts a landscape game only while the device is portrait', () => {
    expect(shouldPromptRotate('landscape', 400, 800)).toBe(true); // portrait device
    expect(shouldPromptRotate('landscape', 800, 400)).toBe(false); // already landscape
  });

  it('prompts a portrait game only while the device is landscape', () => {
    expect(shouldPromptRotate('portrait', 800, 400)).toBe(true); // landscape device
    expect(shouldPromptRotate('portrait', 400, 800)).toBe(false); // already portrait
  });
});
