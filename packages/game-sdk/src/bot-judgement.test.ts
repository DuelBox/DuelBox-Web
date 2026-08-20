import { describe, expect, it } from 'vitest';
import {
  commit,
  createJudgement,
  invalidate,
  misjudgement,
  resetJudgement,
  shouldDecide,
} from './bot-judgement.js';

const STEP = 1 / 60;

describe('a bot judgement', () => {
  it('wants a decision before it has ever made one', () => {
    expect(shouldDecide(createJudgement(), STEP)).toBe(true);
  });

  it('holds its decision for the reaction time, then asks again', () => {
    const judgement = createJudgement();
    shouldDecide(judgement, STEP);
    commit(judgement, 42, 0.2);

    let steps = 0;
    while (!shouldDecide(judgement, STEP) && steps < 600) {
      expect(judgement.value, 'it keeps acting on what it decided').toBe(42);
      steps += 1;
    }
    // 0.2s is twelve steps at sixty a second, give or take the one that crosses zero.
    expect(steps).toBeGreaterThanOrEqual(11);
    expect(steps).toBeLessThanOrEqual(13);
  });

  it('does not bank credit towards the next decision', () => {
    // A long step must not leave the timer negative, or a slow bot reacts twice in quick
    // succession the moment the frame rate stutters.
    const judgement = createJudgement();
    shouldDecide(judgement, STEP);
    commit(judgement, 1, 0.1);
    expect(shouldDecide(judgement, 5), 'a very long step ends the wait').toBe(true);
    expect(judgement.remaining).toBe(0);
    commit(judgement, 2, 0.1);
    expect(shouldDecide(judgement, STEP), 'and the next wait is a full one').toBe(false);
  });

  it('can be told to look again at once', () => {
    // For the moments a person would obviously look again — a new rally, a new approach.
    const judgement = createJudgement();
    shouldDecide(judgement, STEP);
    commit(judgement, 7, 10);
    expect(shouldDecide(judgement, STEP)).toBe(false);
    invalidate(judgement);
    expect(shouldDecide(judgement, STEP)).toBe(true);
  });

  it('clears completely on reset', () => {
    const judgement = createJudgement();
    commit(judgement, 9, 1);
    resetJudgement(judgement);
    expect(judgement.decided).toBe(false);
    expect(judgement.value).toBe(0);
    expect(judgement.remaining).toBe(0);
  });

  it('treats a zero reaction time as deciding every step', () => {
    const judgement = createJudgement();
    shouldDecide(judgement, STEP);
    commit(judgement, 1, 0);
    expect(shouldDecide(judgement, STEP)).toBe(true);
  });

  it('never lets a negative reaction time run the clock backwards', () => {
    const judgement = createJudgement();
    commit(judgement, 1, -5);
    expect(judgement.remaining).toBe(0);
  });
});

describe('a misjudgement', () => {
  it('is symmetric about zero', () => {
    expect(misjudgement(0.5, 100)).toBe(0);
    expect(misjudgement(0, 100)).toBe(-100);
    expect(misjudgement(1, 100)).toBe(100);
  });

  it('averages to zero over many rolls, which is exactly the trap', () => {
    // Drawn once and held it is an error; drawn every step it is nothing at all. This is
    // the arithmetic behind the bug this module exists to prevent — Road Dodge swept its
    // per-step error rate from 0 to 0.5 and survival moved by 0.00 seconds.
    let total = 0;
    const draws = 10_000;
    for (let i = 0; i < draws; i += 1) total += misjudgement((i + 0.5) / draws, 50);
    expect(Math.abs(total / draws), 'it vanishes in the average').toBeLessThan(0.01);
  });

  it('does not vanish when it is drawn once and held', () => {
    const judgement = createJudgement();
    shouldDecide(judgement, STEP);
    commit(judgement, misjudgement(0.9, 50), 0.3);
    const held = judgement.value;
    for (let i = 0; i < 10; i += 1) shouldDecide(judgement, STEP);
    expect(judgement.value, 'the same error, ten steps later').toBe(held);
    expect(Math.abs(held)).toBeGreaterThan(30);
  });
});
