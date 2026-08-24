import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  ARROWS_PER_ROUND,
  ARROWS_PER_SEAT,
  BOT_PROFILES,
  DRAW_SECONDS,
  RING_COUNT,
  ROUNDS,
  SHOTS_PER_MATCH,
  SWAY_MAX,
  UNDERDRAW_DROP,
  WIND_DRIFT_X,
  WIND_DRIFT_Y,
  WIND_Y_LIMIT,
  arrowFor,
  arrowInRoundFor,
  botAim,
  botDwellSeconds,
  createSeatState,
  createShot,
  createSway,
  createWind,
  drawProgress,
  gaussian,
  leaderFor,
  recordArrow,
  resetSeatState,
  resolveShot,
  rollSway,
  rollWind,
  roundFor,
  scatter,
  scoreAt,
  shooterFor,
  swayAmplitude,
  swayAt,
  underdrawDrop,
  windStrength,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotProfile, SeatState, Sway, Wind } from './rules.js';

describe('the target', () => {
  it('scores the innermost ring ten, and calls it a gold', () => {
    const landing = scoreAt(0, 0);
    expect(landing.score).toBe(10);
    expect(landing.ring).toBe(1);
    expect(landing.gold).toBe(true);
  });

  it('scores each of the ten rings one lower than the last', () => {
    for (let ring = 1; ring <= RING_COUNT; ring += 1) {
      // The middle of each ring band, so no boundary is involved.
      const distance = (ring - 0.5) / RING_COUNT;
      expect(scoreAt(distance, 0).score, `ring ${String(ring)}`).toBe(RING_COUNT + 1 - ring);
      expect(scoreAt(distance, 0).ring).toBe(ring);
    }
  });

  it('gives a boundary to the ring inside it', () => {
    // The line belongs to the higher score, as it does on a real boss, and the test walks
    // every boundary because binary floating point does not divide a tenth evenly.
    for (let ring = 1; ring <= RING_COUNT; ring += 1) {
      const boundary = ring / RING_COUNT;
      expect(scoreAt(boundary, 0).ring, `on ${String(boundary)}`).toBe(ring);
      // Past the last ring there is no next ring: the arrow is off the boss.
      const beyond = ring === RING_COUNT ? 0 : ring + 1;
      expect(scoreAt(boundary + 1e-6, 0).ring, `just past ${String(boundary)}`).toBe(beyond);
    }
  });

  it('scores nothing beyond the boss', () => {
    expect(scoreAt(1.0001, 0).score).toBe(0);
    expect(scoreAt(0, -4).score).toBe(0);
    expect(scoreAt(0.8, 0.8).score).toBe(0);
    expect(scoreAt(1.0001, 0).ring).toBe(0);
    expect(scoreAt(1.0001, 0).gold).toBe(false);
  });

  it('scores the same whichever direction the arrow strayed', () => {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
      const x = Math.cos(angle) * 0.55;
      const y = Math.sin(angle) * 0.55;
      expect(scoreAt(x, y).score, `at ${String(angle)}`).toBe(scoreAt(0.55, 0).score);
    }
  });

  it('only ever calls the innermost ring a gold', () => {
    for (let ring = 2; ring <= RING_COUNT; ring += 1) {
      expect(scoreAt((ring - 0.5) / RING_COUNT, 0).gold, `ring ${String(ring)}`).toBe(false);
    }
  });

  it('never scores more than ten, over four thousand arrows', () => {
    const rng = new Rng(4242);
    for (let i = 0; i < 4000; i += 1) {
      const landing = scoreAt(rng.float() * 4 - 2, rng.float() * 4 - 2);
      expect(landing.score).toBeGreaterThanOrEqual(0);
      expect(landing.score).toBeLessThanOrEqual(10);
    }
  });

  it('treats a nonsense coordinate as a miss rather than throwing', () => {
    // Nothing in the game should ever produce one, but a miss is a far better answer
    // than an exception in the middle of a match.
    expect(scoreAt(Number.NaN, 0).score).toBe(0);
    expect(scoreAt(Number.POSITIVE_INFINITY, 0).score).toBe(0);
  });

  it('hands back the same frozen record every time, so nothing can mutate the table', () => {
    const first = scoreAt(0, 0);
    const second = scoreAt(0.02, 0.01);
    expect(second).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
  });
});

describe('the wind', () => {
  it('rolls inside its declared limits', () => {
    const rng = new Rng(99);
    const wind = createWind();
    for (let i = 0; i < 500; i += 1) {
      rollWind(wind, rng);
      expect(Math.abs(wind.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(wind.y)).toBeLessThanOrEqual(WIND_Y_LIMIT);
    }
  });

  it('blows both ways over a run of arrows', () => {
    const rng = new Rng(7);
    const wind = createWind();
    let left = 0;
    let right = 0;
    for (let i = 0; i < 200; i += 1) {
      rollWind(wind, rng);
      if (wind.x < 0) left += 1;
      else right += 1;
    }
    expect(left).toBeGreaterThan(60);
    expect(right).toBeGreaterThan(60);
  });

  it('rolls the same weather from the same seed', () => {
    const a = createWind();
    const b = createWind();
    rollWind(a, new Rng(1234));
    rollWind(b, new Rng(1234));
    expect(a).toEqual(b);
  });

  it('reports a strength a player can read', () => {
    expect(windStrength({ x: 0, y: 0 })).toBe(0);
    expect(windStrength({ x: 1, y: 0 })).toBe(9);
    expect(windStrength({ x: -1, y: 0 })).toBe(9);
    expect(windStrength({ x: 0.5, y: 0 })).toBe(5);
  });

  it('carries a full cross-wind by nearly half the boss', () => {
    // The number that makes the flag worth reading: without it the wind is decoration.
    expect(WIND_DRIFT_X).toBeGreaterThan(0.3);
    expect(WIND_DRIFT_X).toBeLessThan(0.6);
    expect(WIND_DRIFT_Y).toBeLessThan(WIND_DRIFT_X);
  });
});

describe('drawing the bow', () => {
  it('is not drawn at all until the string has been pulled', () => {
    expect(drawProgress(0)).toBe(0);
    expect(drawProgress(-1)).toBe(0);
    expect(underdrawDrop(0)).toBeCloseTo(UNDERDRAW_DROP, 10);
  });

  it('comes to full draw and stays there', () => {
    expect(drawProgress(DRAW_SECONDS)).toBe(1);
    expect(drawProgress(DRAW_SECONDS * 4)).toBe(1);
    expect(underdrawDrop(DRAW_SECONDS)).toBe(0);
    expect(underdrawDrop(DRAW_SECONDS * 4)).toBe(0);
  });

  it('drops an arrow further the less the bow was drawn', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let t = 0; t <= DRAW_SECONDS; t += DRAW_SECONDS / 8) {
      const drop = underdrawDrop(t);
      expect(drop).toBeLessThanOrEqual(previous);
      previous = drop;
    }
  });

  it('puts a completely undrawn arrow off the boss entirely', () => {
    expect(scoreAt(0, underdrawDrop(0)).score).toBe(0);
  });

  it('holds the bow arm still until full draw', () => {
    expect(swayAmplitude(0)).toBe(0);
    expect(swayAmplitude(DRAW_SECONDS / 2)).toBe(0);
    expect(swayAmplitude(DRAW_SECONDS)).toBe(0);
  });

  it('wanders further the longer the draw is held, without ever running away', () => {
    let previous = 0;
    for (let t = DRAW_SECONDS; t < DRAW_SECONDS + 6; t += 0.1) {
      const amplitude = swayAmplitude(t);
      expect(amplitude).toBeGreaterThanOrEqual(previous);
      expect(amplitude).toBeLessThan(SWAY_MAX);
      previous = amplitude;
    }
    expect(previous).toBeGreaterThan(SWAY_MAX * 0.9);
  });

  it('sways as a closed form of held time, so 60 Hz and 120 Hz wander alike', () => {
    // The property the whole fixed-timestep rule rests on: nothing here integrates, so
    // stepping to the same instant in twice as many steps gives the same answer.
    const sway = createSway();
    rollSway(sway, new Rng(5));
    const coarse = { x: 0, y: 0 };
    const fine = { x: 0, y: 0 };
    for (let step = 1; step <= 90; step += 1) {
      swayAt(coarse, sway, step / 60);
      swayAt(fine, sway, (step * 2) / 120);
      expect(fine.x).toBe(coarse.x);
      expect(fine.y).toBe(coarse.y);
    }
  });

  it('rolls a wobble that is never the same shot to shot', () => {
    const rng = new Rng(31);
    const a = createSway();
    const b = createSway();
    rollSway(a, rng);
    rollSway(b, rng);
    expect(a).not.toEqual(b);
    expect(a.rateX).toBeGreaterThan(0);
    expect(a.rateY).toBeGreaterThan(0);
  });

  it('keeps the wobble inside its amplitude in both axes', () => {
    const rng = new Rng(808);
    const sway = createSway();
    const out = { x: 0, y: 0 };
    for (let shot = 0; shot < 40; shot += 1) {
      rollSway(sway, rng);
      for (let t = 0; t < 5; t += 0.05) {
        swayAt(out, sway, t);
        const amplitude = swayAmplitude(t);
        expect(Math.abs(out.x)).toBeLessThanOrEqual(amplitude + 1e-12);
        expect(Math.abs(out.y)).toBeLessThanOrEqual(amplitude + 1e-12);
      }
    }
  });

  it('crosses the middle in both directions, so waiting for it is a real decision', () => {
    const sway = createSway();
    rollSway(sway, new Rng(17));
    const out = { x: 0, y: 0 };
    let positive = false;
    let negative = false;
    for (let t = DRAW_SECONDS; t < DRAW_SECONDS + 4; t += 0.02) {
      swayAt(out, sway, t);
      if (out.x > 0.01) positive = true;
      if (out.x < -0.01) negative = true;
    }
    expect(positive && negative).toBe(true);
  });
});

describe('a shot', () => {
  it('lands where it was aimed when the bow is full and the air is still', () => {
    const shot = createShot();
    shot.aimX = 0.25;
    shot.aimY = -0.4;
    shot.drawSeconds = DRAW_SECONDS;
    const out = { x: 0, y: 0 };
    resolveShot(out, shot);
    expect(out.x).toBeCloseTo(0.25, 12);
    expect(out.y).toBeCloseTo(-0.4, 12);
  });

  it('is carried downwind, by the drift the flag advertises', () => {
    const shot = createShot();
    shot.drawSeconds = DRAW_SECONDS;
    shot.windX = 1;
    const out = { x: 0, y: 0 };
    resolveShot(out, shot);
    expect(out.x).toBeCloseTo(WIND_DRIFT_X, 12);
    shot.windX = -1;
    resolveShot(out, shot);
    expect(out.x).toBeCloseTo(-WIND_DRIFT_X, 12);
  });

  it('is put back on the gold by aiming into the wind', () => {
    // The skill the game is made of: the flag says how far, the archer aims off by it.
    const shot = createShot();
    shot.drawSeconds = DRAW_SECONDS;
    shot.windX = 0.8;
    shot.windY = -0.3;
    shot.aimX = -shot.windX * WIND_DRIFT_X;
    shot.aimY = -shot.windY * WIND_DRIFT_Y;
    const out = { x: 0, y: 0 };
    resolveShot(out, shot);
    expect(scoreAt(out.x, out.y).score).toBe(10);
  });

  it('falls short when the bow was not drawn', () => {
    const shot = createShot();
    shot.drawSeconds = 0;
    const out = { x: 0, y: 0 };
    resolveShot(out, shot);
    expect(out.y).toBeCloseTo(UNDERDRAW_DROP, 12);
    expect(scoreAt(out.x, out.y).score).toBe(0);
  });

  it('adds the wobble at the instant of release', () => {
    const shot = createShot();
    shot.drawSeconds = DRAW_SECONDS;
    shot.swayX = 0.12;
    shot.swayY = -0.07;
    const out = { x: 0, y: 0 };
    resolveShot(out, shot);
    expect(out.x).toBeCloseTo(0.12, 12);
    expect(out.y).toBeCloseTo(-0.07, 12);
  });

  it('sums every error rather than letting one of them win', () => {
    const shot = createShot();
    shot.aimX = 0.1;
    shot.aimY = 0.1;
    shot.swayX = 0.05;
    shot.swayY = 0.05;
    shot.windX = 0.5;
    shot.windY = 0.5;
    shot.scatterX = -0.2;
    shot.scatterY = 0.2;
    shot.drawSeconds = DRAW_SECONDS;
    const out = { x: 0, y: 0 };
    resolveShot(out, shot);
    expect(out.x).toBeCloseTo(0.1 + 0.05 + 0.5 * WIND_DRIFT_X - 0.2, 12);
    expect(out.y).toBeCloseTo(0.1 + 0.05 + 0.5 * WIND_DRIFT_Y + 0.2, 12);
  });

  it('gives a person the shot they loosed, with no hidden scatter', () => {
    const shot = createShot();
    shot.drawSeconds = DRAW_SECONDS;
    shot.aimX = 0.03;
    const out = { x: 0, y: 0 };
    resolveShot(out, shot);
    expect(out.x).toBe(0.03);
    expect(out.y).toBe(0);
  });
});

describe('the card', () => {
  it('starts empty', () => {
    const state = createSeatState();
    expect(state.points).toBe(0);
    expect(state.golds).toBe(0);
    expect(state.arrows).toBe(0);
    expect(state.roundPoints).toEqual([0, 0, 0]);
  });

  it('adds an arrow to the total and to its own round', () => {
    const state = createSeatState();
    recordArrow(state, 1, scoreAt(0.35, 0));
    expect(state.points).toBe(7);
    expect(state.roundPoints[1]).toBe(7);
    expect(state.roundPoints[0]).toBe(0);
    expect(state.arrows).toBe(1);
    expect(state.golds).toBe(0);
  });

  it('counts a gold as ten points and one gold', () => {
    const state = createSeatState();
    recordArrow(state, 0, scoreAt(0.02, 0.02));
    expect(state.points).toBe(10);
    expect(state.golds).toBe(1);
  });

  it('counts a miss as an arrow shot and nothing else', () => {
    const state = createSeatState();
    recordArrow(state, 0, scoreAt(3, 0));
    expect(state.points).toBe(0);
    expect(state.arrows).toBe(1);
  });

  it('ignores a round outside the match rather than growing the card', () => {
    const state = createSeatState();
    recordArrow(state, ROUNDS + 4, scoreAt(0, 0));
    expect(state.points).toBe(10);
    expect(state.roundPoints).toHaveLength(ROUNDS);
  });

  it('empties completely on a reset', () => {
    const state = createSeatState();
    for (let i = 0; i < 5; i += 1) recordArrow(state, i % ROUNDS, scoreAt(0, 0));
    resetSeatState(state);
    expect(state.points).toBe(0);
    expect(state.golds).toBe(0);
    expect(state.arrows).toBe(0);
    expect(state.roundPoints).toEqual([0, 0, 0]);
  });
});

describe('the order of shooting', () => {
  it('has both seats shoot every arrow of every round', () => {
    expect(ARROWS_PER_SEAT).toBe(ROUNDS * ARROWS_PER_ROUND);
    expect(SHOTS_PER_MATCH).toBe(ARROWS_PER_SEAT * 2);
    const counts = { p1: 0, p2: 0 };
    for (let shot = 0; shot < SHOTS_PER_MATCH; shot += 1) counts[shooterFor(shot)] += 1;
    expect(counts.p1).toBe(ARROWS_PER_SEAT);
    expect(counts.p2).toBe(ARROWS_PER_SEAT);
  });

  it('alternates who shoots first, so neither watches the other twice running', () => {
    // Shooting second is a small advantage — you have just watched an arrow fly through
    // the wind you are about to shoot into — so it is shared out exactly evenly.
    const leads = { p1: 0, p2: 0 };
    for (let arrow = 0; arrow < ARROWS_PER_SEAT; arrow += 1) leads[leaderFor(arrow)] += 1;
    expect(leads.p1).toBe(leads.p2);
    expect(leaderFor(0)).not.toBe(leaderFor(1));
  });

  it('shoots the AB–BA rotation target archery actually uses', () => {
    // One seat does shoot twice running, across the boundary between two arrows, and
    // that is the point of the rotation rather than a defect in it: p1 p2, then p2 p1.
    // It is what keeps the count of second shots equal without ever giving the same seat
    // the second shot twice in the same pair.
    expect(shooterFor(0)).toBe('p1');
    expect(shooterFor(1)).toBe('p2');
    expect(shooterFor(2)).toBe('p2');
    expect(shooterFor(3)).toBe('p1');
    expect(shooterFor(4)).toBe('p1');
  });

  it('counts arrows and rounds off the shot index', () => {
    expect(arrowFor(0)).toBe(0);
    expect(arrowFor(1)).toBe(0);
    expect(arrowFor(2)).toBe(1);
    expect(roundFor(0)).toBe(0);
    expect(roundFor(ARROWS_PER_ROUND * 2 - 1)).toBe(0);
    expect(roundFor(ARROWS_PER_ROUND * 2)).toBe(1);
    expect(roundFor(SHOTS_PER_MATCH - 1)).toBe(ROUNDS - 1);
    expect(arrowInRoundFor(0)).toBe(0);
    expect(arrowInRoundFor(ARROWS_PER_ROUND * 2)).toBe(0);
    expect(arrowInRoundFor(ARROWS_PER_ROUND * 2 - 2)).toBe(ARROWS_PER_ROUND - 1);
  });

  it('gives both seats the same wind at the same arrow', () => {
    // Not a property of the ordering but of the pairing it produces: the two shots of an
    // arrow are consecutive, so one weather roll serves both.
    for (let shot = 0; shot < SHOTS_PER_MATCH; shot += 2) {
      expect(arrowFor(shot)).toBe(arrowFor(shot + 1));
      expect(shooterFor(shot)).not.toBe(shooterFor(shot + 1));
    }
  });
});

describe('the win condition', () => {
  function card(points: number, golds = 0): SeatState {
    const state = createSeatState();
    state.points = points;
    state.golds = golds;
    return state;
  }

  it('decides nothing while arrows are left', () => {
    expect(winnerOf(card(80), card(20), false)).toBeNull();
    expect(winnerOf(card(0), card(0), false)).toBeNull();
  });

  it('gives it to the higher total once the match is over', () => {
    expect(winnerOf(card(84), card(83), true)).toBe('p1');
    expect(winnerOf(card(12), card(97), true)).toBe('p2');
  });

  it('breaks a tie on points with the count of golds', () => {
    expect(winnerOf(card(90, 4), card(90, 3), true)).toBe('p1');
    expect(winnerOf(card(90, 1), card(90, 6), true)).toBe('p2');
  });

  it('calls a tie on points and on golds a draw, because it is one', () => {
    expect(winnerOf(card(77, 2), card(77, 2), true)).toBe('draw');
    expect(winnerOf(card(0, 0), card(0, 0), true)).toBe('draw');
  });

  it('never lets golds overturn a difference in points', () => {
    // The tie-break only ever runs on a tie: an archer who shot more golds and fewer
    // points still loses, which is what "most points" means.
    expect(winnerOf(card(70, 12), card(71, 0), true)).toBe('p2');
  });

  it('is symmetric under swapping the seats', () => {
    const rng = new Rng(2026);
    for (let i = 0; i < 200; i += 1) {
      const a = card(rng.int(0, 121), rng.int(0, 13));
      const b = card(rng.int(0, 121), rng.int(0, 13));
      const forwards = winnerOf(a, b, true);
      const backwards = winnerOf(b, a, true);
      const mirrored = backwards === 'p1' ? 'p2' : backwards === 'p2' ? 'p1' : backwards;
      expect(mirrored).toBe(forwards);
    }
  });
});

// ---------------------------------------------------------------------------
// The bot
// ---------------------------------------------------------------------------

/**
 * One bot arrow, resolved through exactly the arithmetic the game uses.
 *
 * The game's own turn machinery is tested in `game.test.ts`; this drives the rules
 * directly so several hundred matches a tier can be measured in a fraction of a second.
 */
function botArrow(profile: BotProfile, wind: Wind, sway: Sway, rng: Rng): number {
  const aim = { x: 0, y: 0 };
  const hand = { x: 0, y: 0 };
  const wobble = { x: 0, y: 0 };
  const landed = { x: 0, y: 0 };
  botAim(aim, wind, profile);
  scatter(hand, profile.spread, rng);
  const held = DRAW_SECONDS + botDwellSeconds(profile, rng);
  swayAt(wobble, sway, held);
  const shot = createShot();
  shot.aimX = aim.x;
  shot.aimY = aim.y;
  shot.swayX = wobble.x;
  shot.swayY = wobble.y;
  shot.windX = wind.x;
  shot.windY = wind.y;
  shot.scatterX = hand.x;
  shot.scatterY = hand.y;
  shot.drawSeconds = held;
  resolveShot(landed, shot);
  return scoreAt(landed.x, landed.y).score;
}

/** A whole match between two tiers, under one shared sequence of weather. */
function botMatch(a: BotDifficulty, b: BotDifficulty, seed: number): { a: number; b: number } {
  const rng = new Rng(seed);
  const wind = createWind();
  const sway = createSway();
  let aPoints = 0;
  let bPoints = 0;
  for (let arrow = 0; arrow < ARROWS_PER_SEAT; arrow += 1) {
    rollWind(wind, rng);
    rollSway(sway, rng);
    aPoints += botArrow(BOT_PROFILES[a], wind, sway, rng);
    rollSway(sway, rng);
    bPoints += botArrow(BOT_PROFILES[b], wind, sway, rng);
  }
  return { a: aPoints, b: bPoints };
}

function averageArrow(tier: BotDifficulty, seed: number, arrows = 4000): number {
  const rng = new Rng(seed);
  const wind = createWind();
  const sway = createSway();
  let total = 0;
  for (let i = 0; i < arrows; i += 1) {
    rollWind(wind, rng);
    rollSway(sway, rng);
    total += botArrow(BOT_PROFILES[tier], wind, sway, rng);
  }
  return total / arrows;
}

function winRate(a: BotDifficulty, b: BotDifficulty, matches = 400): number {
  let wins = 0;
  let decided = 0;
  for (let i = 0; i < matches; i += 1) {
    const result = botMatch(a, b, 1000 + i * 17);
    if (result.a === result.b) continue;
    decided += 1;
    if (result.a > result.b) wins += 1;
  }
  return decided === 0 ? 0.5 : wins / decided;
}

describe('the bot', () => {
  const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('offers three tiers, all of them imperfect', () => {
    for (const tier of TIERS) {
      const profile = BOT_PROFILES[tier];
      expect(profile.spread, tier).toBeGreaterThan(0);
      expect(profile.windRead, tier).toBeGreaterThan(0);
      expect(profile.windRead, tier).toBeLessThanOrEqual(1);
      expect(profile.dwell, tier).toBeGreaterThanOrEqual(0);
      expect(profile.dwellSpread, tier).toBeGreaterThan(0);
    }
  });

  it('orders the tiers by every knob it has', () => {
    expect(BOT_PROFILES.hard.spread).toBeLessThan(BOT_PROFILES.normal.spread);
    expect(BOT_PROFILES.normal.spread).toBeLessThan(BOT_PROFILES.easy.spread);
    expect(BOT_PROFILES.hard.windRead).toBeGreaterThan(BOT_PROFILES.normal.windRead);
    expect(BOT_PROFILES.normal.windRead).toBeGreaterThan(BOT_PROFILES.easy.windRead);
    expect(BOT_PROFILES.hard.dwell).toBeLessThan(BOT_PROFILES.normal.dwell);
    expect(BOT_PROFILES.normal.dwell).toBeLessThan(BOT_PROFILES.easy.dwell);
  });

  it('aims into the wind, by as much of it as the tier can read', () => {
    const aim = { x: 0, y: 0 };
    const wind: Wind = { x: 1, y: 0 };
    botAim(aim, wind, BOT_PROFILES.hard);
    expect(aim.x).toBeLessThan(0);
    const hard = aim.x;
    botAim(aim, wind, BOT_PROFILES.easy);
    expect(aim.x).toBeLessThan(0);
    expect(aim.x, 'the weak archer allows for less of it').toBeGreaterThan(hard);
  });

  it('points at the middle when the air is still', () => {
    const aim = { x: 0, y: 0 };
    botAim(aim, { x: 0, y: 0 }, BOT_PROFILES.easy);
    expect(Math.abs(aim.x)).toBe(0);
    expect(Math.abs(aim.y)).toBe(0);
  });

  it('never aims further off than a person is allowed to', () => {
    // Rule 6 in the other direction: the bot must not be able to point somewhere the
    // human sight cannot reach. A full wind allowance is well inside the sight's travel.
    const aim = { x: 0, y: 0 };
    botAim(aim, { x: 1, y: WIND_Y_LIMIT }, BOT_PROFILES.hard);
    expect(Math.abs(aim.x)).toBeLessThan(1);
    expect(Math.abs(aim.y)).toBeLessThan(1);
  });

  it('scatters as a finite normal cloud, five thousand arrows deep', () => {
    const rng = new Rng(555);
    const out = { x: 0, y: 0 };
    let inside = 0;
    for (let i = 0; i < 5000; i += 1) {
      scatter(out, 0.2, rng);
      expect(Number.isFinite(out.x)).toBe(true);
      expect(Number.isFinite(out.y)).toBe(true);
      if (Math.hypot(out.x, out.y) < 0.2) inside += 1;
    }
    // A two-dimensional normal puts about 39% of its mass inside one sigma.
    expect(inside / 5000).toBeGreaterThan(0.3);
    expect(inside / 5000).toBeLessThan(0.5);
  });

  it('draws a standard normal that is centred and finite', () => {
    const rng = new Rng(31337);
    let total = 0;
    for (let i = 0; i < 20000; i += 1) {
      const value = gaussian(rng);
      expect(Number.isFinite(value)).toBe(true);
      total += value;
    }
    expect(Math.abs(total / 20000)).toBeLessThan(0.05);
  });

  it('never dithers for a negative time', () => {
    const rng = new Rng(64);
    for (const tier of TIERS) {
      for (let i = 0; i < 500; i += 1) {
        expect(botDwellSeconds(BOT_PROFILES[tier], rng)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('shoots better the higher the tier, measured over four thousand arrows', () => {
    const easy = averageArrow('easy', 11);
    const normal = averageArrow('normal', 11);
    const hard = averageArrow('hard', 11);
    expect(easy).toBeLessThan(normal);
    expect(normal).toBeLessThan(hard);
    // Recorded in SPEC.md. The bands are wide enough to survive a tweak and narrow
    // enough that a tier collapsing into another one fails here.
    expect(easy).toBeGreaterThan(3);
    expect(easy).toBeLessThan(6.5);
    expect(hard).toBeGreaterThan(8.5);
  });

  it('wins more often the higher the tier, over four hundred matches a pairing', () => {
    const hardOverEasy = winRate('hard', 'easy');
    const hardOverNormal = winRate('hard', 'normal');
    const normalOverEasy = winRate('normal', 'easy');
    expect(hardOverEasy).toBeGreaterThan(0.95);
    expect(hardOverNormal).toBeGreaterThan(0.75);
    expect(normalOverEasy).toBeGreaterThan(0.8);
  });

  it('is an even match against itself, which is what a fair ladder looks like', () => {
    const level = winRate('normal', 'normal');
    expect(level).toBeGreaterThan(0.35);
    expect(level).toBeLessThan(0.65);
  });

  it('plays the identical match from the identical seed', () => {
    expect(botMatch('normal', 'hard', 909)).toEqual(botMatch('normal', 'hard', 909));
    expect(botMatch('easy', 'easy', 4)).not.toEqual(botMatch('easy', 'easy', 5));
  });

  it('cannot score more than the target allows, whatever the tier', () => {
    for (const tier of TIERS) {
      const result = botMatch(tier, tier, 77);
      expect(result.a).toBeLessThanOrEqual(ARROWS_PER_SEAT * 10);
      expect(result.a).toBeGreaterThanOrEqual(0);
    }
  });
});
