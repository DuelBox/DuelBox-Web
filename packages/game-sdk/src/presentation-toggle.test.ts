import { describe, expect, it } from 'vitest';
import { createPresentationToggle, otherPresentation } from './presentation-toggle.js';

/**
 * The dev-only presentation toggle (#1863).
 *
 * The one property that matters for shipping is that it does nothing in production. It cannot
 * read `process.env` itself — the SDK is typed without Node and forbidden the device — so the
 * host passes `enabled: process.env.NODE_ENV !== 'production'`, which folds to `false` in a
 * production build and takes the whole thing with it. These tests stand in for both builds by
 * passing the flag both ways.
 */

describe('otherPresentation', () => {
  it('flips between the two', () => {
    expect(otherPresentation('shared-screen')).toBe('single-seat');
    expect(otherPresentation('single-seat')).toBe('shared-screen');
  });
});

describe('the toggle when enabled (a development build)', () => {
  it('flips the presentation and reports each new value', () => {
    const toggle = createPresentationToggle('shared-screen', true);
    expect(toggle.presentation).toBe('shared-screen');
    expect(toggle.enabled).toBe(true);
    expect(toggle.toggle()).toBe('single-seat');
    expect(toggle.presentation).toBe('single-seat');
    expect(toggle.toggle()).toBe('shared-screen');
  });

  it('sets a specific presentation', () => {
    const toggle = createPresentationToggle('shared-screen', true);
    toggle.set('single-seat');
    expect(toggle.presentation).toBe('single-seat');
    toggle.set('single-seat');
    expect(toggle.presentation).toBe('single-seat');
  });
});

describe('the toggle when disabled (a production build)', () => {
  it('is inert: every flip and set is a no-op and it says so', () => {
    const toggle = createPresentationToggle('shared-screen', false);
    expect(toggle.enabled).toBe(false);
    expect(toggle.toggle()).toBe('shared-screen');
    expect(toggle.presentation).toBe('shared-screen');
    toggle.set('single-seat');
    expect(toggle.presentation).toBe('shared-screen');
  });

  it('defaults to disabled, so a toggle built without the flag cannot change a live match', () => {
    // The default is the safe one on purpose: forgetting the flag ships an inert toggle, not a
    // live one. A production build both passes false and drops the construction entirely.
    const toggle = createPresentationToggle('single-seat');
    expect(toggle.enabled).toBe(false);
    expect(toggle.toggle()).toBe('single-seat');
  });
});
