// THROWAWAY verifier harness. Deleted before the audit finishes.
import { InputManager, InputView, Rng } from '@duelbox/engine';
import mod from './dist/index.js';
import {
  GUARD_V,
  PARRY_REACH,
  SWORD_SPEED,
  TARGETS_PER_SEAT,
  TARGET_V,
  CAPTURE_RADIUS,
  MAX_THROWS,
  WIN_HITS,
} from './dist/rules.js';

const STEP = 1 / 60;
const STEP_CAP = 60 * 600;

function otherOf(seat) {
  return seat === 'p1' ? 'p2' : 'p1';
}

function rackSnapshot(state, out) {
  for (let i = 0; i < TARGETS_PER_SEAT; i += 1) {
    out[i] = state.p1.struck[i];
    out[i + TARGETS_PER_SEAT] = state.p2.struck[i];
  }
  return out;
}

// Independent geometric reconstruction of the target strike: quadratic re-derived here,
// not imported from the game.
function geoHit(slots, u0, v0, du, dv, from, until) {
  let best = -1;
  let bestT = Infinity;
  for (let i = 0; i < TARGETS_PER_SEAT; i += 1) {
    const ou = u0 - slots[i];
    const ov = v0 - TARGET_V;
    const a = SWORD_SPEED * SWORD_SPEED;
    const b = 2 * SWORD_SPEED * (ou * du + ov * dv);
    const c = ou * ou + ov * ov - CAPTURE_RADIUS * CAPTURE_RADIUS;
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;
    const r = Math.sqrt(disc);
    let t = (-b - r) / (2 * a);
    if (t < from) t = (-b + r) / (2 * a);
    if (t < from || t > until) continue;
    if (t < bestT) {
      bestT = t;
      best = i;
    }
  }
  return best;
}

function playMatch(seed, d1, d2) {
  const game = mod.create();
  const manifest = mod.manifest;
  game.init({
    manifest,
    rng: new Rng(seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    botDifficulty: (seat) => (seat === 'p1' ? d1 : d2),
  });
  const input = new InputManager(manifest.logical, { split: 'shared', bottomSeat: 'p1' });
  const view = new InputView();
  const state = game.state;

  const before = new Array(TARGETS_PER_SEAT * 2).fill(0);
  const after = new Array(TARGETS_PER_SEAT * 2).fill(0);

  const m = {
    throws: 0,
    hits: 0,
    parries: 0,
    misses: 0,
    geoParries: 0,
    geoHits: 0,
    geoAgreeParry: 0,
    geoAgreeHit: 0,
    perSeatThrows: { p1: 0, p2: 0 },
    perSeatHits: { p1: 0, p2: 0 },
    perSeatParries: { p1: 0, p2: 0 },
    steps: 0,
    winner: undefined,
    capReached: false,
    finished: false,
    scoreP1: 0,
    scoreP2: 0,
  };

  let flight = null;

  for (let s = 0; s < STEP_CAP; s += 1) {
    const prevPhase = state.phase;
    const thrower = state.thrower;
    const defender = otherOf(thrower);
    const bladeBefore = defender === 'p1' ? state.p1.blade : state.p2.blade;
    rackSnapshot(state, before);

    game.update(STEP, view.sync(input.beginStep(STEP)));
    m.steps = s + 1;

    const curPhase = state.phase;
    rackSnapshot(state, after);
    let struck = -1;
    for (let i = 0; i < after.length; i += 1) {
      if (after[i] > before[i]) struck = i;
    }

    if (prevPhase === 'aiming' && curPhase !== 'aiming') {
      m.throws += 1;
      m.perSeatThrows[thrower] += 1;
      flight = {
        thrower,
        defender,
        guardTime: state.shot.guardTime,
        u0: state.shot.u0,
        v0: state.shot.v0,
        du: state.shot.du,
        dv: state.shot.dv,
        slots: state.slots.slice(),
        samples: [{ t: 0, blade: bladeBefore }],
      };
    }
    if (flight !== null && curPhase === 'flying') {
      const b = flight.defender === 'p1' ? state.p1.blade : state.p2.blade;
      flight.samples.push({ t: state.shot.elapsed, blade: b });
    }

    if (prevPhase === 'flying' && curPhase !== 'flying') {
      const b = flight.defender === 'p1' ? state.p1.blade : state.p2.blade;
      flight.samples.push({ t: state.shot.elapsed, blade: b });
      const restV = state.shot.v;
      const restU = state.shot.u;

      // --- reconstructed from sampled state, no game flags read ---
      let outcome;
      if (struck >= 0) outcome = 'hit';
      else if (Math.abs(restV - GUARD_V) < 1e-9) outcome = 'parry';
      else outcome = 'miss';

      if (outcome === 'hit') {
        m.hits += 1;
        m.perSeatHits[flight.thrower] += 1;
        // sanity: the sword must have landed in the DEFENDER's rack
        const wantBase = flight.defender === 'p1' ? 0 : TARGETS_PER_SEAT;
        if (struck < wantBase || struck >= wantBase + TARGETS_PER_SEAT) {
          throw new Error(`hit landed in the wrong rack: struck=${struck} def=${flight.defender}`);
        }
      } else if (outcome === 'parry') {
        m.parries += 1;
        m.perSeatParries[flight.defender] += 1;
        if (Math.abs(restU - GUARD_V) === 0) {
          /* unreachable, keeps restU used */
        }
      } else {
        m.misses += 1;
      }

      // --- independent geometry, from sampled blade positions ---
      const last = flight.samples[flight.samples.length - 1];
      let geo;
      if (last.t + 1e-12 < flight.guardTime) {
        geo = 'miss';
      } else {
        let k = 1;
        while (k < flight.samples.length && flight.samples[k].t < flight.guardTime - 1e-12) k += 1;
        const a = flight.samples[k - 1];
        const c = flight.samples[k];
        const span = c.t - a.t;
        const frac = span > 0 ? (flight.guardTime - a.t) / span : 1;
        const bladeAt = a.blade + (c.blade - a.blade) * Math.min(1, Math.max(0, frac));
        const crossing = flight.u0 + flight.du * SWORD_SPEED * flight.guardTime;
        if (Math.abs(crossing - bladeAt) <= PARRY_REACH) geo = 'parry';
        else {
          const idx = geoHit(
            flight.slots,
            flight.u0,
            flight.v0,
            flight.du,
            flight.dv,
            flight.guardTime,
            10,
          );
          geo = idx >= 0 ? 'hit' : 'miss';
        }
      }
      if (geo === 'parry') m.geoParries += 1;
      if (geo === 'hit') m.geoHits += 1;
      if (geo === outcome && outcome === 'parry') m.geoAgreeParry += 1;
      if (geo === outcome && outcome === 'hit') m.geoAgreeHit += 1;
      if (geo !== outcome) {
        m.disagree = (m.disagree ?? 0) + 1;
        m.disagreeSample ??= `${outcome} vs ${geo} @seed ${seed}`;
      }
      flight = null;
    }

    const score = game.getScore();
    if (score.winner !== null) {
      m.winner = score.winner;
      m.finished = true;
      m.scoreP1 = score.p1;
      m.scoreP2 = score.p2;
      break;
    }
  }
  m.capReached = state.throws >= MAX_THROWS;
  if (!m.finished) {
    m.scoreP1 = game.getScore().p1;
    m.scoreP2 = game.getScore().p2;
  }
  game.destroy();
  return m;
}

const TIERS = ['easy', 'normal', 'hard'];

function agg() {
  return {
    throws: 0,
    hits: 0,
    parries: 0,
    misses: 0,
    geoParries: 0,
    geoHits: 0,
    disagree: 0,
    matches: 0,
    unfinished: 0,
    capReached: 0,
    maxSteps: 0,
    maxThrows: 0,
    p1: 0,
    p2: 0,
    draw: 0,
    p1Throws: 0,
    p2Throws: 0,
    p1Hits: 0,
    p2Hits: 0,
    p1Parries: 0,
    p2Parries: 0,
  };
}

function absorb(a, m) {
  a.matches += 1;
  a.throws += m.throws;
  a.hits += m.hits;
  a.parries += m.parries;
  a.misses += m.misses;
  a.geoParries += m.geoParries;
  a.geoHits += m.geoHits;
  a.disagree += m.disagree ?? 0;
  if (!m.finished) a.unfinished += 1;
  if (m.capReached) a.capReached += 1;
  a.maxSteps = Math.max(a.maxSteps, m.steps);
  a.maxThrows = Math.max(a.maxThrows, m.throws);
  if (m.winner === 'p1') a.p1 += 1;
  else if (m.winner === 'p2') a.p2 += 1;
  else a.draw += 1;
  a.p1Throws += m.perSeatThrows.p1;
  a.p2Throws += m.perSeatThrows.p2;
  a.p1Hits += m.perSeatHits.p1;
  a.p2Hits += m.perSeatHits.p2;
  a.p1Parries += m.perSeatParries.p1;
  a.p2Parries += m.perSeatParries.p2;
}

const mode = process.argv[2] ?? 'mechanic';

if (mode === 'mechanic') {
  const families = [40000, 717000, 1234567];
  const total = agg();
  const byTier = { easy: agg(), normal: agg(), hard: agg() };
  for (const base of families) {
    for (const tier of TIERS) {
      for (let i = 0; i < 150; i += 1) {
        const m = playMatch(base + i, tier, tier);
        absorb(total, m);
        absorb(byTier[tier], m);
      }
    }
  }
  const pc = (n, d) => (d === 0 ? '0.0' : ((100 * n) / d).toFixed(1));
  console.log('=== MECHANIC AUDIT (equal tiers, 3 seed families x 150 x 3 tiers) ===');
  console.log(
    `matches ${total.matches} throws ${total.throws} hits ${total.hits} (${pc(total.hits, total.throws)}%) ` +
      `parries ${total.parries} (${pc(total.parries, total.throws)}%) misses ${total.misses} (${pc(total.misses, total.throws)}%)`,
  );
  console.log(
    `accounting: hits+parries+misses = ${total.hits + total.parries + total.misses} vs throws ${total.throws}`,
  );
  console.log(
    `geometry cross-check: geoParries ${total.geoParries} geoHits ${total.geoHits} disagreements ${total.disagree}`,
  );
  console.log(
    `hits/match ${(total.hits / total.matches).toFixed(2)} parries/match ${(total.parries / total.matches).toFixed(2)}`,
  );
  console.log(
    `unfinished ${total.unfinished} capReached ${total.capReached} maxSteps ${total.maxSteps} (${(total.maxSteps / 60).toFixed(1)}s) maxThrows ${total.maxThrows}`,
  );
  for (const tier of TIERS) {
    const a = byTier[tier];
    console.log(
      `  ${tier.padEnd(6)} throws ${a.throws} hit ${pc(a.hits, a.throws)}% parry ${pc(a.parries, a.throws)}% miss ${pc(a.misses, a.throws)}% | ` +
        `p1 hitrate ${pc(a.p1Hits, a.p1Throws)}% p2 hitrate ${pc(a.p2Hits, a.p2Throws)}% | ` +
        `p1 parryrate ${pc(a.p1Parries, a.p2Throws)}% p2 parryrate ${pc(a.p2Parries, a.p1Throws)}% | ` +
        `p1 wins ${a.p1} p2 ${a.p2} draw ${a.draw} (p1 share ${pc(a.p1, a.p1 + a.p2)}%) | maxSteps ${a.maxSteps} (${(a.maxSteps / 60).toFixed(1)}s)`,
    );
  }
}

if (mode === 'ladder') {
  const pairs = [
    ['normal', 'easy'],
    ['hard', 'easy'],
    ['hard', 'normal'],
    ['easy', 'easy'],
    ['normal', 'normal'],
    ['hard', 'hard'],
  ];
  console.log('=== LADDER (300 seeds x both seat orders) ===');
  for (const [strong, weak] of pairs) {
    let sw = 0;
    let ww = 0;
    let dr = 0;
    let maxSteps = 0;
    let unfinished = 0;
    for (let i = 0; i < 300; i += 1) {
      const a = playMatch(40000 + i, strong, weak);
      if (a.winner === 'p1') sw += 1;
      else if (a.winner === 'p2') ww += 1;
      else dr += 1;
      maxSteps = Math.max(maxSteps, a.steps);
      if (!a.finished) unfinished += 1;
      const b = playMatch(40000 + i, weak, strong);
      if (b.winner === 'p2') sw += 1;
      else if (b.winner === 'p1') ww += 1;
      else dr += 1;
      maxSteps = Math.max(maxSteps, b.steps);
      if (!b.finished) unfinished += 1;
    }
    const n = 600;
    console.log(
      `${strong} v ${weak}: stronger ${((100 * sw) / n).toFixed(1)}% weaker ${((100 * ww) / n).toFixed(1)}% draws ${((100 * dr) / n).toFixed(1)}% | maxSteps ${maxSteps} (${(maxSteps / 60).toFixed(1)}s) unfinished ${unfinished}`,
    );
  }
}

if (mode === 'seatbalance') {
  console.log('=== SEAT BALANCE (p1 share of decided) ===');
  for (const tier of TIERS) {
    const rows = [];
    for (const base of [40000, 717000, 1234567, 990001]) {
      let p1 = 0;
      let p2 = 0;
      let dr = 0;
      for (let i = 0; i < 150; i += 1) {
        const m = playMatch(base + i, tier, tier);
        if (m.winner === 'p1') p1 += 1;
        else if (m.winner === 'p2') p2 += 1;
        else dr += 1;
      }
      rows.push(`${((100 * p1) / (p1 + p2)).toFixed(1)}% (n=${p1 + p2}, draws ${dr})`);
    }
    console.log(`  ${tier.padEnd(6)} ${rows.join(' | ')}`);
  }
}

if (mode === 'worstcase') {
  // Force the throw cap: measure the longest match anyone can construct at the slowest tier.
  console.log('=== WORST CASE ===');
  let worst = 0;
  let worstSeed = -1;
  let capped = 0;
  for (let i = 0; i < 400; i += 1) {
    const m = playMatch(500000 + i, 'easy', 'easy');
    if (m.steps > worst) {
      worst = m.steps;
      worstSeed = 500000 + i;
    }
    if (m.capReached) capped += 1;
  }
  console.log(
    `easy v easy over 400 seeds: worst ${worst} steps (${(worst / 60).toFixed(1)}s) seed ${worstSeed}, cap reached ${capped}`,
  );
  console.log(`structural: MAX_THROWS ${MAX_THROWS} WIN_HITS ${WIN_HITS}`);
}
