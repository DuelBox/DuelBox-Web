import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Frogs Fight, as pure rules.
 *
 * Two frogs share one pond of lily pads. Bugs settle on the pads; a frog scores by landing
 * on the pad a bug is sitting on. A fly is worth one, a dragonfly five, and the first frog
 * to ten takes the match.
 *
 * ## Frogs hop between pads, they do not swim between them
 *
 * The whole game is discrete. A frog is either sitting on one of twenty-five pads or in the
 * air between two of them, and a push chooses a *neighbour*, never a heading. That is what
 * makes this a game of reading the pond rather than a chase: you commit to a landing before
 * you know what the other frog will do, and a hop you have started cannot be called back.
 * It also gives the whole simulation a state space small enough to reason about — the pad
 * graph is fixed, so every distance in the game is a table lookup rather than a search.
 *
 * ## The pond is its own reflection, and that is what makes the seats equal
 *
 * Pad `i` and pad `24 - i` sit at points reflected through the centre of the pond, *exactly*
 * — the scatter that stops the pads looking like graph paper is stored once and negated for
 * the reflected half, so the symmetry survives it. The two frogs start on reflected home
 * pads. Bugs settle uniformly over the free pads, and "the free pads" is a set that reflects
 * onto itself.
 *
 * Put together: relabelling the two players and reflecting the pond maps a match onto an
 * equally likely match with the seats exchanged. So for any pair of strategies, p1's score
 * playing `A` against `B` has the same distribution as p2's score playing `A` against `B`
 * from the other seat. **Neither seat is better placed, and that is a consequence of the
 * layout rather than a number somebody tuned.**
 *
 * What it is *not* is Robot Arena's guarantee. There the hazards themselves came in
 * reflected pairs, so both robots were threatened identically at the same instant. Here a
 * single bug lands on a single pad and one frog really is nearer it — that contest is the
 * game. The symmetry makes the two seats equal *in distribution*, not in each individual
 * bug, and the difference matters for the dragonfly (see below).
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit.
 */

export const POND = 800;
export const CENTRE = POND / 2;

/** The pond is a 5 x 5 scatter of pads: odd, so one pad sits on the centre of symmetry. */
export const GRID = 5;
export const PAD_COUNT = GRID * GRID;
const SPACING = 140;
const MARGIN = 120;

export const PAD_RADIUS = 50;
export const FROG_RADIUS = 26;

/**
 * The scatter, as offsets for the first twelve pads only.
 *
 * Pad `24 - i` takes the negation, and pad 12 sits dead centre with none, so the pond is
 * point-symmetric by construction whatever numbers this table holds — a property that
 * cannot be broken by editing it, only by editing the code that reads it.
 *
 * Every offset is at most 12 units, which is what keeps the neighbourhood clean: the widest
 * diagonal pair on the pond is 214.5 units apart and the nearest pair that is *not* a
 * neighbour is 258, so {@link HOP_RANGE} at 244 separates them with room on both sides.
 */
const SCATTER: readonly number[] = [
  9, -7, -11, 5, 6, 11, 12, -4, -8, -12, -5, 10, 11, 8, -12, -6, 4, -11, 10, 12, -9, 3, 7, -12,
];

/** How far a frog can hop. Chosen so a pad's neighbours are exactly the eight around it. */
export const HOP_RANGE = 244;

/**
 * How wide a push may be off a pad's bearing and still count as aiming at it.
 *
 * Neighbours sit roughly 45 degrees apart, so 70 is generous enough that nobody has to aim,
 * and narrow enough that pushing at the edge of the pond — where the pad you wanted does
 * not exist — leaves the frog sitting rather than sliding somewhere it was not sent.
 */
export const HOP_ARC_DEGREES = 70;
const HOP_ARC_COS = Math.cos((HOP_ARC_DEGREES * Math.PI) / 180);

/** Flight time: a fixed launch cost plus the distance covered. A longer hop costs more. */
export const HOP_MIN_SECONDS = 0.16;
export const HOP_SECONDS_PER_UNIT = 0.001;
/** A beat on the pad after landing, before the frog can push off again. */
export const REST_SECONDS = 0.1;

export const FLY_POINTS = 1;
export const DRAGONFLY_POINTS = 5;
export const TARGET_POINTS = 10;

/** Live bugs at once. Fixed, so nothing allocates per step. */
export const MAX_BUGS = 2;
export const SPAWN_SECONDS = 2;
export const FIRST_SPAWN_SECONDS = 0.6;
export const BUG_LIFE_SECONDS = 6.5;
/** Every sixth bug is a dragonfly — a cadence, not a dice roll. See the note on fairness. */
export const DRAGONFLY_EVERY = 6;
/**
 * How many bugs the pond will ever serve. This is what ends the match.
 *
 * Not a clock: the counter only ever rises, the spawn timer is a fixed positive interval and
 * every bug leaves after a fixed life, so the pond runs dry in bounded simulated time
 * however well or badly the match is played. Two frogs who never catch anything finish 0-0;
 * two who catch everything finish long before the budget is spent.
 */
export const BUG_BUDGET = 60;

/** The two starting pads: opposite corners, each the other's reflection. */
export const P1_HOME = 20;
export const P2_HOME = 4;

/** Reflect a pad through the centre of the pond. The one operation seat fairness rests on. */
export function mirrorPad(pad: number): number {
  return PAD_COUNT - 1 - pad;
}

function buildPads(): { readonly x: number[]; readonly y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (let pad = 0; pad < PAD_COUNT; pad += 1) {
    const row = Math.floor(pad / GRID);
    const col = pad % GRID;
    const source = Math.min(pad, mirrorPad(pad));
    const sign = pad === source ? 1 : -1;
    // Pad 12 is the centre of symmetry and is its own reflection, so it takes no offset.
    const offsetX = source === 12 ? 0 : SCATTER[source * 2]!;
    const offsetY = source === 12 ? 0 : SCATTER[source * 2 + 1]!;
    x.push(MARGIN + col * SPACING + sign * offsetX);
    y.push(MARGIN + row * SPACING + sign * offsetY);
  }
  return { x, y };
}

const pads = buildPads();
export const PAD_X: readonly number[] = pads.x;
export const PAD_Y: readonly number[] = pads.y;

/** Seconds in the air for a hop between two pads. Identical for both frogs, always. */
export function hopSeconds(from: number, to: number): number {
  const distance = Math.hypot(PAD_X[from]! - PAD_X[to]!, PAD_Y[from]! - PAD_Y[to]!);
  return HOP_MIN_SECONDS + distance * HOP_SECONDS_PER_UNIT;
}

function buildReach(): readonly (readonly number[])[] {
  const reach: number[][] = [];
  for (let from = 0; from < PAD_COUNT; from += 1) {
    const near: number[] = [];
    for (let to = 0; to < PAD_COUNT; to += 1) {
      if (to === from) continue;
      const distance = Math.hypot(PAD_X[from]! - PAD_X[to]!, PAD_Y[from]! - PAD_Y[to]!);
      if (distance <= HOP_RANGE) near.push(to);
    }
    reach.push(near);
  }
  return reach;
}

/** Which pads a frog on each pad can reach in one hop. Static: the pond never moves. */
export const REACH = buildReach();

/**
 * Every pad's travel time to every other, and the first hop along the way.
 *
 * The pad graph is fixed for the life of the process, so this is solved once at load rather
 * than searched per decision. It is why the bot costs nothing measurable per step, and why
 * "how far is that bug" is a lookup for the fairness rules as well as for the bot.
 *
 * The edge weight is a hop's flight plus the rest that follows it, and the stored figure has
 * one rest taken back off — the frog is not resting when it arrives. Minimising the two is
 * the same thing, since they differ by a constant.
 */
function buildRoutes(): { readonly time: number[]; readonly next: number[] } {
  const size = PAD_COUNT * PAD_COUNT;
  const time: number[] = new Array<number>(size).fill(Number.POSITIVE_INFINITY);
  const next: number[] = new Array<number>(size).fill(-1);
  for (let from = 0; from < PAD_COUNT; from += 1) {
    time[from * PAD_COUNT + from] = 0;
    next[from * PAD_COUNT + from] = from;
    for (const to of REACH[from]!) {
      time[from * PAD_COUNT + to] = hopSeconds(from, to) + REST_SECONDS;
      next[from * PAD_COUNT + to] = to;
    }
  }
  for (let via = 0; via < PAD_COUNT; via += 1) {
    for (let from = 0; from < PAD_COUNT; from += 1) {
      const toVia = time[from * PAD_COUNT + via]!;
      if (!Number.isFinite(toVia)) continue;
      for (let to = 0; to < PAD_COUNT; to += 1) {
        const through = toVia + time[via * PAD_COUNT + to]!;
        if (through < time[from * PAD_COUNT + to]!) {
          time[from * PAD_COUNT + to] = through;
          next[from * PAD_COUNT + to] = next[from * PAD_COUNT + via]!;
        }
      }
    }
  }
  for (let from = 0; from < PAD_COUNT; from += 1) {
    for (let to = 0; to < PAD_COUNT; to += 1) {
      if (from === to) continue;
      time[from * PAD_COUNT + to] = time[from * PAD_COUNT + to]! - REST_SECONDS;
    }
  }
  /*
   * Force each route and its reflection to exactly the same number.
   *
   * They already agree to within 4.4e-16 — the pond reflects exactly, so the two routes are
   * the same sum of the same distances, added up in a different order. That is small enough
   * to be invisible and large enough to be *not equal*, and the dragonfly's placement rule
   * asks whether two arrival times are equal. Taking the smaller of the pair costs nothing
   * (the route table `next` was already exactly symmetric) and turns "fair to within a
   * rounding error" into an equality a test can assert.
   */
  for (let from = 0; from < PAD_COUNT; from += 1) {
    for (let to = 0; to < PAD_COUNT; to += 1) {
      const here = from * PAD_COUNT + to;
      const there = mirrorPad(from) * PAD_COUNT + mirrorPad(to);
      const shared = Math.min(time[here]!, time[there]!);
      time[here] = shared;
      time[there] = shared;
    }
  }
  return { time, next };
}

const routes = buildRoutes();

/** Seconds a ready frog on `from` needs to land on `to`, by the quickest route. */
export function travel(from: number, to: number): number {
  return routes.time[from * PAD_COUNT + to]!;
}

/** The first pad to hop to when heading for `to`. Equal to `from` only when already there. */
export function nextHop(from: number, to: number): number {
  return routes.next[from * PAD_COUNT + to]!;
}

export interface Frog {
  /** The pad it is sitting on, or the pad it is in the air towards. */
  pad: number;
  /** The pad it left. Equal to `pad` while sitting; only the drawing reads it. */
  from: number;
  /** Seconds of flight left, 0 while sitting. */
  flight: number;
  /** Seconds this hop takes in total, so the drawing can place it along the arc. */
  flightTotal: number;
  /** Seconds on the pad before it may push off again. */
  rest: number;
  score: number;
  /** The pad it drifts back to when there is nothing worth chasing. */
  readonly home: number;
}

export interface Bug {
  active: boolean;
  pad: number;
  /** {@link FLY_POINTS} or {@link DRAGONFLY_POINTS}. The kind is the value. */
  points: number;
  /** Seconds before it flies off. */
  life: number;
  lifeTotal: number;
}

export interface Game {
  readonly p1: Frog;
  readonly p2: Frog;
  readonly bugs: Bug[];
  /** Seconds until the next bug settles. */
  nextBug: number;
  /** Bugs served this match. Only ever rises, and it is what ends the match. */
  served: number;
  elapsed: number;
  winner: SeatId | 'draw' | null;
  /** Scratch: the pads a bug could settle on. Reused, so a spawn allocates nothing. */
  readonly candidates: number[];
  /** Scratch: the pads tied for fairest, when a dragonfly is placed. */
  readonly tied: number[];
}

function makeFrog(home: number): Frog {
  return { pad: home, from: home, flight: 0, flightTotal: 0, rest: 0, score: 0, home };
}

function makeBug(): Bug {
  return { active: false, pad: 0, points: FLY_POINTS, life: 0, lifeTotal: BUG_LIFE_SECONDS };
}

export function createGame(): Game {
  const bugs: Bug[] = [];
  for (let i = 0; i < MAX_BUGS; i += 1) bugs.push(makeBug());
  return {
    p1: makeFrog(P1_HOME),
    p2: makeFrog(P2_HOME),
    bugs,
    nextBug: FIRST_SPAWN_SECONDS,
    served: 0,
    elapsed: 0,
    winner: null,
    candidates: [],
    tied: [],
  };
}

export function resetGame(game: Game): void {
  resetFrog(game.p1);
  resetFrog(game.p2);
  for (const bug of game.bugs) bug.active = false;
  game.nextBug = FIRST_SPAWN_SECONDS;
  game.served = 0;
  game.elapsed = 0;
  game.winner = null;
  game.candidates.length = 0;
  game.tied.length = 0;
}

function resetFrog(frog: Frog): void {
  frog.pad = frog.home;
  frog.from = frog.home;
  frog.flight = 0;
  frog.flightTotal = 0;
  frog.rest = 0;
  frog.score = 0;
}

export function frogOf(game: Readonly<Game>, seat: SeatId): Frog {
  return seat === 'p1' ? game.p1 : game.p2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function scoreOf(game: Readonly<Game>, seat: SeatId): number {
  return frogOf(game, seat).score;
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

/** The bug sitting on a pad, or null. At most one bug ever occupies a pad. */
export function bugOn(game: Readonly<Game>, pad: number): Bug | null {
  for (const bug of game.bugs) {
    if (bug.active && bug.pad === pad) return bug;
  }
  return null;
}

/**
 * Which neighbour a push aims at, or -1 for none.
 *
 * The push is a *direction*, never a position — see the note in game.ts on why an absolute
 * pointer cannot work on a shared board. Bearing decides it, so a thumb and a key express
 * exactly the same thing and neither can aim finer than the other: there are at most eight
 * answers, and the scatter on the pads means no two of them ever tie for a keyboard push.
 */
export function padTowards(from: number, dirX: number, dirY: number): number {
  const length = Math.hypot(dirX, dirY);
  if (length < 1e-6) return -1;
  const unitX = dirX / length;
  const unitY = dirY / length;
  let best = -1;
  let bestCos = HOP_ARC_COS;
  let bestDistance = 0;
  for (const pad of REACH[from]!) {
    const offsetX = PAD_X[pad]! - PAD_X[from]!;
    const offsetY = PAD_Y[pad]! - PAD_Y[from]!;
    const distance = Math.hypot(offsetX, offsetY);
    const cos = (offsetX * unitX + offsetY * unitY) / distance;
    if (cos > bestCos || (cos === bestCos && distance < bestDistance)) {
      best = pad;
      bestCos = cos;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Push a frog. Returns whether it left the pad.
 *
 * The only way any frog ever moves — a person's thumb, a person's keys and every bot tier
 * all arrive here with a direction and nothing else, so no bot can reach a pad a player
 * cannot reach or reach it any sooner (CLAUDE.md rule 6).
 */
export function hopFrog(game: Game, seat: SeatId, dirX: number, dirY: number): boolean {
  const frog = frogOf(game, seat);
  if (frog.flight > 0 || frog.rest > 0) return false;
  const target = padTowards(frog.pad, dirX, dirY);
  if (target < 0) return false;
  frog.from = frog.pad;
  frog.pad = target;
  frog.flightTotal = hopSeconds(frog.from, target);
  frog.flight = frog.flightTotal;
  return true;
}

/** Seconds before a frog could be standing on `pad`, counting the hop it is already in. */
export function arrivalSeconds(frog: Readonly<Frog>, pad: number): number {
  return frog.flight + frog.rest + travel(frog.pad, pad);
}

/** One fixed step. Frogs are pushed by the caller first. */
export function step(game: Game, fixedDeltaSeconds: number, rng: Rng): void {
  if (game.winner !== null) return;
  game.elapsed += fixedDeltaSeconds;
  ageBugs(game, fixedDeltaSeconds);
  landFrogs(game, fixedDeltaSeconds);
  serveBug(game, fixedDeltaSeconds, rng);
  settle(game);
}

/** Bugs age before frogs land, so a bug already leaving is not caught on its way out. */
function ageBugs(game: Game, fixedDeltaSeconds: number): void {
  for (const bug of game.bugs) {
    if (!bug.active) continue;
    bug.life -= fixedDeltaSeconds;
    if (bug.life <= 0) bug.active = false;
  }
}

/**
 * Advance both flights and settle whatever the landings caught.
 *
 * **Landings inside one step are ordered by how far past zero the flight timer went**, not
 * by which frog the loop reads first. Two frogs can be in the air for the same bug and land
 * on the same step; resolving that by iteration order would hand the bug to p1 every time —
 * a seat bias made of nothing but code layout, and the same mistake Fruit Duel made when it
 * settled a round as each blade arrived rather than afterwards.
 *
 * An exact tie is a **shared meal**: both frogs score the bug. Two landings that a fixed
 * step cannot separate are two landings that did not happen at different times, and
 * inventing an order for them would be a lie the game told every time it happened.
 */
function landFrogs(game: Game, fixedDeltaSeconds: number): void {
  const first = advanceFrog(game.p1, fixedDeltaSeconds);
  const second = advanceFrog(game.p2, fixedDeltaSeconds);
  if (first < 0 && second < 0) return;
  if (first > second) {
    takeBug(game, game.p1, first);
    takeBug(game, game.p2, second);
    return;
  }
  if (second > first) {
    takeBug(game, game.p2, second);
    takeBug(game, game.p1, first);
    return;
  }
  shareBug(game);
}

/** Seconds past the landing instant this step went, or -1 if the frog did not land. */
function advanceFrog(frog: Frog, fixedDeltaSeconds: number): number {
  if (frog.flight > 0) {
    frog.flight -= fixedDeltaSeconds;
    if (frog.flight > 0) return -1;
    const overshoot = -frog.flight;
    frog.flight = 0;
    frog.from = frog.pad;
    // The rest is shortened by however much of the step was spent already sitting there, so
    // a frog is not made to wait for the fixed step's grid.
    frog.rest = Math.max(0, REST_SECONDS - overshoot);
    return overshoot;
  }
  if (frog.rest > 0) frog.rest = Math.max(0, frog.rest - fixedDeltaSeconds);
  return -1;
}

function takeBug(game: Game, frog: Frog, overshoot: number): void {
  if (overshoot < 0) return;
  const bug = bugOn(game, frog.pad);
  if (bug === null) return;
  frog.score += bug.points;
  bug.active = false;
}

/** Both frogs landed at the same instant: each scores whatever is under it, including one bug. */
function shareBug(game: Game): void {
  const forP1 = bugOn(game, game.p1.pad);
  const forP2 = bugOn(game, game.p2.pad);
  if (forP1 !== null) game.p1.score += forP1.points;
  if (forP2 !== null) game.p2.score += forP2.points;
  if (forP1 !== null) forP1.active = false;
  if (forP2 !== null) forP2.active = false;
}

/**
 * The pads a bug may settle on: no bug there already, and neither frog standing on it or in
 * the air towards it. A bug landing under a frog would be a gift, and a gift is exactly what
 * the seat-fairness argument cannot afford.
 *
 * The set reflects onto itself whenever the pond does, which is what makes the uniform draw
 * below symmetric between the seats rather than merely unbiased.
 */
export function candidatePads(game: Game): readonly number[] {
  const list = game.candidates;
  list.length = 0;
  for (let pad = 0; pad < PAD_COUNT; pad += 1) {
    if (pad === game.p1.pad || pad === game.p2.pad) continue;
    if (bugOn(game, pad) !== null) continue;
    list.push(pad);
  }
  return list;
}

/**
 * Where a dragonfly settles: the free pad the two frogs can reach in the most nearly equal
 * time, with a uniform draw among any that tie.
 *
 * **A fly is placed uniformly and a dragonfly is not, and the difference is the point.** A
 * fly is worth a tenth of the match, so luck in where it lands averages out over the ten or
 * so a match serves — the reflection argument says it averages to exactly nothing. A
 * dragonfly is worth *half the match*, and "fair on average over many matches" is no comfort
 * at all in the one match you are playing: dropping it two hops from one frog and five from
 * the other would decide the match by a dice roll nobody could answer. So the big prize is
 * placed where it is a race, and both frogs are told at once.
 *
 * The rule reflects like everything else — hop times are unchanged by reflecting the pond,
 * so the fairest pad for a reflected position is the reflection of the fairest pad.
 */
function balancedPad(game: Game, rng: Rng): number {
  let fairest = Number.POSITIVE_INFINITY;
  for (const pad of game.candidates) {
    const gap = Math.abs(arrivalSeconds(game.p1, pad) - arrivalSeconds(game.p2, pad));
    if (gap < fairest) fairest = gap;
  }
  const tied = game.tied;
  tied.length = 0;
  // A second pass rather than a running list, so the answer cannot depend on the order the
  // pads happened to be visited in — which is the order a reflection reverses.
  for (const pad of game.candidates) {
    const gap = Math.abs(arrivalSeconds(game.p1, pad) - arrivalSeconds(game.p2, pad));
    if (gap <= fairest + TIE_SECONDS) tied.push(pad);
  }
  return tied[rng.int(0, tied.length)]!;
}

/** Two arrival times inside this are the same arrival time, for placement purposes. */
export const TIE_SECONDS = 1e-6;

function serveBug(game: Game, fixedDeltaSeconds: number, rng: Rng): void {
  game.nextBug -= fixedDeltaSeconds;
  if (game.nextBug > 0) return;
  game.nextBug = SPAWN_SECONDS;
  if (game.served >= BUG_BUDGET) return;

  let slot: Bug | null = null;
  for (const bug of game.bugs) {
    if (!bug.active) {
      slot = bug;
      break;
    }
  }
  // The pond is full. The timer has already been reset, so the next one comes along when a
  // bug has left — which is what keeps `served` rising and the match finite.
  if (slot === null) return;

  candidatePads(game);
  if (game.candidates.length === 0) return;

  const dragonfly = (game.served + 1) % DRAGONFLY_EVERY === 0;
  slot.pad = dragonfly
    ? balancedPad(game, rng)
    : game.candidates[rng.int(0, game.candidates.length)]!;
  slot.points = dragonfly ? DRAGONFLY_POINTS : FLY_POINTS;
  slot.life = BUG_LIFE_SECONDS;
  slot.lifeTotal = BUG_LIFE_SECONDS;
  slot.active = true;
  game.served += 1;
}

function settle(game: Game): void {
  if (game.p1.score >= TARGET_POINTS || game.p2.score >= TARGET_POINTS) {
    decide(game);
    return;
  }
  if (game.served < BUG_BUDGET) return;
  for (const bug of game.bugs) {
    if (bug.active) return;
  }
  decide(game);
}

function decide(game: Game): void {
  game.winner =
    game.p1.score === game.p2.score ? 'draw' : game.p1.score > game.p2.score ? 'p1' : 'p2';
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Seconds it spends choosing, overlapping the rest every frog owes after a landing. */
  readonly reaction: number;
  /** How often it pushes at a neighbour at random instead of the one it wanted. */
  readonly blunder: number;
  /** How completely it gives up on a bug the other frog will reach first, in 0..1. */
  readonly rival: number;
}

/**
 * Three tiers, all of them seeing exactly the pond a player sees.
 *
 * They differ in how long they take to choose, how often they fumble the push, and whether
 * they notice the other frog is nearer — never in hop speed, hop reach, rest, or knowledge
 * of where the next bug will land. Bug lifetimes are drawn on the screen as a shrinking
 * ring, so reading them is reading the board.
 *
 * `hard` chooses in 0.04 s, which is inside human reaction time and would be a rule 6
 * problem in a game where reacting was the skill. It is not one here: a person holding a
 * direction hops the instant the rest ends, so `hard` is exactly as quick off a pad as a
 * held thumb and no quicker — the 0.1 s rest binds them both.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({ reaction: 0.3, blunder: 0.3, rival: 0 }),
  normal: Object.freeze({ reaction: 0.14, blunder: 0.12, rival: 0.6 }),
  hard: Object.freeze({ reaction: 0.04, blunder: 0.03, rival: 1 }),
});

export interface BotState {
  /** Seconds left of the current think. */
  think: number;
}

export function createBotState(): BotState {
  return { think: 0 };
}

export function resetBotState(state: BotState): void {
  state.think = 0;
}

/**
 * Values a bot draws per decision. Always exactly this many, whatever it decides.
 *
 * This is the Fruit Duel rule: a seat whose draw count depends on what it chose shifts the
 * other seat's stream, and that is a seat bias made of arithmetic. Both values are drawn
 * before anything branches on either of them.
 *
 * It leaves one gap that this game had to find on its own: it says nothing about *how often*
 * a seat decides. See the note on {@link botIntent} for what happened when that was chased.
 */
export const BOT_DRAWS_PER_DECISION = 2;

/** Softens the divide so a bug two hops away is not worth half a bug one hop away. */
const VALUE_FLOOR = 0.4;

/**
 * How far behind the other frog a bug has to be before it is worth giving up on.
 *
 * Roughly one hop. **Conceding on the bare comparison made the best tier the worst one:**
 * `hard` gave up on any bug the other frog was nearer to *at all*, which is most of them by
 * a few hundredths of a second, so it spent the match hopping home while `normal` contested
 * everything and won. Measured over 200 seeded matches a pairing without this margin, `hard`
 * took only 57% and 51% of its matches against `normal` from the two seats, and beat `easy`
 * 67% and 70% where `normal` beat it 96% from both. With the margin: 89% and 90% against
 * `normal`, 100% and 99% against `easy`.
 *
 * A margin fixes it because a photo finish is worth entering and a hopeless chase is not,
 * which is the distinction "who is nearer" fails to make.
 */
const CONTEST_SECONDS = 0.55;

/**
 * Which pad the bot is heading for: the best bug it can still reach, or its own home.
 *
 * Value is points over time, so a dragonfly five hops off beats a fly two hops off and a fly
 * under its nose beats a dragonfly on the far bank. A bug that will have flown before the
 * frog can land is not considered at all — the clock on it is drawn on the screen.
 *
 * Home is the fallback rather than the centre of the pond, and that is deliberate: two bots
 * idling on the *same* pad make the same choices from the same place and land together on
 * every bug, which shares every one of them and draws the match. Two homes that are
 * reflections keep the two frogs apart without favouring either.
 */
function chooseGoal(game: Readonly<Game>, seat: SeatId, profile: BotProfile): number {
  const frog = frogOf(game, seat);
  const rival = frogOf(game, otherOf(seat));
  let goal = frog.home;
  let best = 0;
  for (const bug of game.bugs) {
    if (!bug.active) continue;
    const mine = travel(frog.pad, bug.pad);
    if (mine > bug.life) continue;
    let value = bug.points / (mine + VALUE_FLOOR);
    const theirs = arrivalSeconds(rival, bug.pad);
    if (theirs < mine) {
      value *= 1 - profile.rival * Math.min(1, (mine - theirs) / CONTEST_SECONDS);
    }
    if (value > best) {
      best = value;
      goal = bug.pad;
    }
  }
  return goal;
}

/**
 * Where the bot pushes. Writes a direction into `out`, which the caller hands to
 * {@link hopFrog} — the same door a thumb comes through.
 *
 * ## Each seat's bot draws from its own stream, and here that is not optional
 *
 * Fruit Duel's fix — a constant number of draws per decision — removes the coupling between
 * two seats sharing one generator *when both seats decide on the same schedule*. In this
 * game they do not. A frog decides when it lands, and when it lands depends on how long a
 * hop it chose, so the **number** of decisions a seat makes by a given moment is a function
 * of what that seat decided. Sharing one stream would therefore let p1's choices shift p2's
 * draws even with the draw count nailed down: Fruit Duel's bug wearing a different hat.
 *
 * So game.ts seeds one generator per bot from the match seed and hands each seat its own. It
 * is worth recording that this **measures as nothing**: 500 matches a tier with one shared
 * generator sit inside the noise of 500 with two (SPEC.md has the table). The difference from
 * Fruit Duel is that there the draw *count* varied with the outcome, which correlates a
 * seat's mistake with the other seat's stream; here only the *timing* varies, and it shifts
 * both seats alike. The split is kept because independence by construction is worth two
 * integers, not because it fixed an observed bug. The constant-draw rule is kept as well, and
 * asserted by a test, because the two answers guard different things.
 */
export function botIntent(
  game: Readonly<Game>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  fixedDeltaSeconds: number,
  rng: Rng,
  out: { x: number; y: number },
): void {
  out.x = 0;
  out.y = 0;
  const profile = BOT_PROFILES[difficulty];
  const frog = frogOf(game, seat);
  // Thinking restarts in mid-air: a hop cannot be called back, so there is nothing to decide
  // until the frog is on a pad again.
  if (frog.flight > 0) {
    state.think = profile.reaction;
    return;
  }
  state.think -= fixedDeltaSeconds;
  if (frog.rest > 0 || state.think > 0) return;
  state.think = profile.reaction;

  // Both values first, unconditionally. See BOT_DRAWS_PER_DECISION.
  const fumble = rng.float();
  const stray = rng.float();

  const reach = REACH[frog.pad]!;
  let target: number;
  if (fumble < profile.blunder) {
    target = reach[Math.min(reach.length - 1, Math.floor(stray * reach.length))]!;
  } else {
    const goal = chooseGoal(game, seat, profile);
    if (goal === frog.pad) return;
    target = nextHop(frog.pad, goal);
  }
  out.x = PAD_X[target]! - PAD_X[frog.pad]!;
  out.y = PAD_Y[target]! - PAD_Y[frog.pad]!;
}
