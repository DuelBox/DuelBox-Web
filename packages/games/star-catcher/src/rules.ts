import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Star Catcher, as pure rules.
 *
 * Stars drift across your sky and you steer a net into them. Black holes drift too, and one
 * of those takes a star back off you. First to seven.
 *
 * ## One sky, dealt twice
 *
 * Both seats fly through the **identical** sky: every star and every hole is spawned once,
 * from one seeded stream, and pushed into both fields with the same position and the same
 * drift. The two are not similar, they are the same numbers — so the question "was one
 * player's sky kinder?" has an answer before anybody moves, and the answer is no.
 *
 * That is the same shape as Gravity Run's course and Broken Tiles' floor, and it is the
 * cheapest fairness there is: a shared deal costs one array and removes a whole class of
 * measurement. What it cannot do is make the *contest* symmetric, and here there is no
 * contest to make symmetric — the two players never touch each other's sky, so the game is
 * two identical solo problems raced side by side. **[ours]**
 *
 * No rendering, no timing, no DOM.
 */

export const FIELD_WIDTH = 640;
export const FIELD_HEIGHT = 460;

/**
 * The net, and the two numbers that decide whether the game asks anything.
 *
 * The first pair — radius 40 at 330 units a second — made almost every star catchable
 * whatever you did: the net crossed the sky in under two seconds and its mouth was a
 * seventh of the field wide, so a tier aiming sixty units off still bumped into what it was
 * chasing. All three tiers caught within a quarter of a star of each other. Smaller and
 * slower is what turns a drifting star into a decision about which one to go for.
 */
export const NET_RADIUS = 29;
export const NET_SPEED = 235;

export const STAR_RADIUS = 17;
export const HOLE_RADIUS = 30;

/** How fast a drifting thing crosses the sky. Fast enough that a late start is a lost star. */
export const DRIFT_SPEED = 150;

export const TARGET_STARS = 10;

/**
 * What a black hole costs.
 *
 * **Two, and the first version's one inverted the difficulty ladder.** At a cost of one, a
 * star gained and a hole avoided are worth the same, so steering round anything is a losing
 * trade — the cautious tier collected 4.5 stars a match to the reckless tier's 6.8 and lost
 * 85 matches in a hundred. Making the mistake cost twice what the prize pays is what turns
 * "be aware of black holes" from decoration into the decision the genre says it is.
 */
export const HOLE_COST = 2;

/**
 * How many things the sky holds at once, and how many it ever spawns.
 *
 * `SPAWNS` is the termination guarantee and it is a plain counter: the sky deals exactly
 * this many and then stops, so a match between two players who never move ends when the last
 * one drifts off. No clock is involved, and nothing about how the match is played can add
 * one.
 */
export const MAX_DRIFTERS = 13;
export const SPAWNS = 110;

/** Seconds between spawns, and the interval it decays toward as the match goes on. */
export const FIRST_INTERVAL = 0.55;
export const MIN_INTERVAL = 0.26;
export const INTERVAL_DECAY = 0.965;

/** How often a spawn is a hole rather than a star. */
export const HOLE_SHARE = 0.32;

/** Seconds of calm before the first star arrives. */
export const GRACE_SECONDS = 0.8;

export type Phase = 'grace' | 'flying' | 'over';

export interface Drifter {
  active: boolean;
  hole: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Net {
  x: number;
  y: number;
}

export interface Game {
  /** The sky, dealt once and shared by value: both seats see these same positions. */
  readonly drifters: Drifter[];
  readonly p1: Net;
  readonly p2: Net;
  /** Which drifters each seat has already taken, so one star is not caught twice. */
  readonly p1Taken: boolean[];
  readonly p2Taken: boolean[];
  p1Stars: number;
  p2Stars: number;
  phase: Phase;
  elapsed: number;
  /** Seconds until the next spawn, and the interval that spawn will use. */
  nextSpawn: number;
  interval: number;
  /** How many have been dealt so far. */
  spawned: number;
  hold: number;
  winner: SeatId | 'draw' | null;
}

function makeDrifter(): Drifter {
  return { active: false, hole: false, x: 0, y: 0, vx: 0, vy: 0 };
}

function makeNet(): Net {
  return { x: FIELD_WIDTH / 2, y: FIELD_HEIGHT / 2 };
}

export function createGame(): Game {
  const drifters: Drifter[] = [];
  for (let i = 0; i < MAX_DRIFTERS; i += 1) drifters.push(makeDrifter());
  return {
    drifters,
    p1: makeNet(),
    p2: makeNet(),
    p1Taken: new Array<boolean>(MAX_DRIFTERS).fill(false),
    p2Taken: new Array<boolean>(MAX_DRIFTERS).fill(false),
    p1Stars: 0,
    p2Stars: 0,
    phase: 'grace',
    elapsed: 0,
    nextSpawn: 0,
    interval: FIRST_INTERVAL,
    spawned: 0,
    hold: GRACE_SECONDS,
    winner: null,
  };
}

export function netOf(game: Readonly<Game>, seat: SeatId): Net {
  return seat === 'p1' ? game.p1 : game.p2;
}

export function takenBy(game: Readonly<Game>, seat: SeatId): boolean[] {
  return seat === 'p1' ? game.p1Taken : game.p2Taken;
}

export function starsOf(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Stars : game.p2Stars;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function resetGame(game: Game): void {
  for (const drifter of game.drifters) drifter.active = false;
  game.p1.x = FIELD_WIDTH / 2;
  game.p1.y = FIELD_HEIGHT / 2;
  game.p2.x = FIELD_WIDTH / 2;
  game.p2.y = FIELD_HEIGHT / 2;
  game.p1Taken.fill(false);
  game.p2Taken.fill(false);
  game.p1Stars = 0;
  game.p2Stars = 0;
  game.phase = 'grace';
  game.elapsed = 0;
  game.interval = FIRST_INTERVAL;
  game.nextSpawn = FIRST_INTERVAL;
  game.spawned = 0;
  game.hold = GRACE_SECONDS;
  game.winner = null;
}

/**
 * Move a net toward a point, no faster than its own speed.
 *
 * Rate-limited rather than teleporting to the finger, which is what makes a star that has
 * drifted past you genuinely gone — and what makes a key and a thumb cover the sky in the
 * same time.
 */
export function driveNet(
  net: Net,
  wantedX: number,
  wantedY: number,
  fixedDeltaSeconds: number,
): void {
  const dx = wantedX - net.x;
  const dy = wantedY - net.y;
  const distance = Math.hypot(dx, dy);
  const reach = NET_SPEED * fixedDeltaSeconds;
  if (distance <= reach) {
    net.x = wantedX;
    net.y = wantedY;
  } else if (distance > 0) {
    net.x += (dx / distance) * reach;
    net.y += (dy / distance) * reach;
  }
  net.x = clamp(net.x, NET_RADIUS, FIELD_WIDTH - NET_RADIUS);
  net.y = clamp(net.y, NET_RADIUS, FIELD_HEIGHT - NET_RADIUS);
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Values drawn per spawn. Always exactly this many.
 *
 * The two bots share the game's `Rng` with the sky itself, so a variable count anywhere
 * shifts everything after it — the seat bias made of arithmetic that Fruit Duel was caught
 * by. A spawn draws its kind, its entry point and its heading, in that order, whatever it
 * turns out to be.
 */
export const SPAWN_DRAWS = 3;
/**
 * How hard a hole on the flight path pushes a star down the shortlist.
 *
 * Swept: at 4 the sharpest tier still flew through everything (3.4 holes a match), at 60 it
 * was down to 1.9, and 200 changed nothing further. It saturates because the penalty only has
 * to outweigh the distance term, and past that the shortlist is already reordered.
 */
export const AVOID_WEIGHT = 60;
/** How much a star still having a long way to fall is worth, against how far off it is. */
export const LEAVE_WEIGHT = 0.25;
/** The bonus a bot's existing target keeps, so a quick look confirms plans as well as changing them. */
export const STICKINESS = 90;

function spawn(game: Game, rng: Rng): void {
  const kindRoll = rng.float();
  const entryRoll = rng.float();
  const headingRoll = rng.float();

  let slot = -1;
  for (let i = 0; i < game.drifters.length; i += 1) {
    if (!(game.drifters[i] as Drifter).active) {
      slot = i;
      break;
    }
  }
  game.spawned += 1;
  if (slot < 0) return;

  const drifter = game.drifters[slot] as Drifter;
  drifter.active = true;
  drifter.hole = kindRoll < HOLE_SHARE;
  // In from one of the two sides, so everything crosses the whole sky and nothing appears
  // under a net.
  const fromLeft = entryRoll < 0.5;
  drifter.x = fromLeft ? -STAR_RADIUS : FIELD_WIDTH + STAR_RADIUS;
  drifter.y = NET_RADIUS + ((entryRoll * 2) % 1) * (FIELD_HEIGHT - NET_RADIUS * 2);
  const slant = (headingRoll - 0.5) * 0.9;
  drifter.vx = (fromLeft ? 1 : -1) * DRIFT_SPEED;
  drifter.vy = slant * DRIFT_SPEED;

  // A fresh slot is nobody's yet.
  game.p1Taken[slot] = false;
  game.p2Taken[slot] = false;
}

export interface StepResult {
  /** Seats that caught a star this step. */
  readonly caught: readonly SeatId[];
  /** Seats that hit a hole this step. */
  readonly stung: readonly SeatId[];
}

const caughtScratch: SeatId[] = [];
const stungScratch: SeatId[] = [];
const result = { caught: caughtScratch, stung: stungScratch };
const SEATS: readonly SeatId[] = ['p1', 'p2'];

/** One fixed step. Nets are moved by the caller first. */
export function step(game: Game, fixedDeltaSeconds: number, rng: Rng): StepResult {
  caughtScratch.length = 0;
  stungScratch.length = 0;
  if (game.phase === 'over') return result;

  if (game.phase === 'grace') {
    game.hold -= fixedDeltaSeconds;
    if (game.hold <= 0) game.phase = 'flying';
    return result;
  }

  game.elapsed += fixedDeltaSeconds;

  for (const drifter of game.drifters) {
    if (!drifter.active) continue;
    drifter.x += drifter.vx * fixedDeltaSeconds;
    drifter.y += drifter.vy * fixedDeltaSeconds;
    if (drifter.y < STAR_RADIUS || drifter.y > FIELD_HEIGHT - STAR_RADIUS) drifter.vy = -drifter.vy;
    const margin = HOLE_RADIUS * 2;
    if (drifter.x < -margin || drifter.x > FIELD_WIDTH + margin) drifter.active = false;
  }

  if (game.spawned < SPAWNS) {
    game.nextSpawn -= fixedDeltaSeconds;
    if (game.nextSpawn <= 0) {
      spawn(game, rng);
      game.interval = Math.max(MIN_INTERVAL, game.interval * INTERVAL_DECAY);
      game.nextSpawn = game.interval;
    }
  }

  // Both seats are tested against the same sky before either score changes, so two nets
  // reaching the same star on the same step both get it — they are, after all, two
  // different stars in two different skies that happen to hold the same numbers.
  for (const seat of SEATS) {
    const net = netOf(game, seat);
    const taken = takenBy(game, seat);
    for (let i = 0; i < game.drifters.length; i += 1) {
      const drifter = game.drifters[i] as Drifter;
      if (!drifter.active || taken[i] === true) continue;
      const radius = drifter.hole ? HOLE_RADIUS : STAR_RADIUS;
      if (Math.hypot(drifter.x - net.x, drifter.y - net.y) > NET_RADIUS + radius) continue;

      taken[i] = true;
      if (drifter.hole) {
        award(game, seat, -HOLE_COST);
        stungScratch.push(seat);
      } else {
        award(game, seat, 1);
        caughtScratch.push(seat);
      }
    }
  }

  if (
    game.p1Stars >= TARGET_STARS ||
    game.p2Stars >= TARGET_STARS ||
    (game.spawned >= SPAWNS && !anyActive(game))
  ) {
    finish(game);
  }
  return result;
}

function anyActive(game: Readonly<Game>): boolean {
  for (const drifter of game.drifters) if (drifter.active) return true;
  return false;
}

/** Stars never go below zero: a hole can cost a lead, never put a player in debt. */
function award(game: Game, seat: SeatId, stars: number): void {
  if (seat === 'p1') game.p1Stars = Math.max(0, game.p1Stars + stars);
  else game.p2Stars = Math.max(0, game.p2Stars + stars);
}

function finish(game: Game): void {
  game.phase = 'over';
  game.winner = game.p1Stars === game.p2Stars ? 'draw' : game.p1Stars > game.p2Stars ? 'p1' : 'p2';
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Seconds between decisions; between them it holds the target it chose. */
  readonly reaction: number;
  /** How far ahead it leads a moving star, in seconds. */
  readonly lead: number;
  /** How wide a berth it gives a hole, as a multiple of the radii that would touch. */
  readonly caution: number;
  /**
   * How far off the middle of a star it actually aims, in units.
   *
   * **Every tier's value sits above `NET_RADIUS + STAR_RADIUS`, and that is not decoration.**
   * Below the catch distance a wander costs nothing at all — the net arrives off-centre and
   * still closes on the star — so the knob is simply dead there. It was set to 22 for
   * `normal` and 8 for `hard` for a long stretch, which is to say it was doing nothing for
   * either of them while reading in the source as the main difficulty axis. Sweeping it
   * showed the cliff exactly at the catch distance: 22 and 46 gave the same result, 60 cost
   * two seconds a match and 90 cost seven.
   */
  readonly aim: number;
  /**
   * How far across the sky it looks for something worth chasing, in units.
   *
   * The tiers' main axis, and the one that actually moved them apart. Reaction, lead and
   * caution all turned out to change a tier's score by a fraction of a star, because a net
   * that can cross the field in two seconds catches what it is pointed at whatever it knows.
   * What a weaker player really does is fail to notice the star on the far side until it has
   * gone — which is short sight, not slow hands.
   */
  readonly sight: number;
}

/**
 * Three tiers, expressed as how often a tier looks, how far it leads its target, and how
 * carefully it steers round a hole.
 *
 * Nothing here is hidden from a player: the whole sky is on the screen and every drifter
 * moves in a straight line at a constant speed. Leading a target is arithmetic anybody does
 * by eye, which makes rule 6 easy to keep — there is no information to withhold, only
 * accuracy to withdraw.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.3, lead: 0, caution: 0.8, aim: 96, sight: 210 },
  normal: { reaction: 0.2, lead: 0.6, caution: 1.1, aim: 72, sight: 380 },
  hard: { reaction: 0.06, lead: 1, caution: 1.5, aim: 50, sight: 1000 },
});

export interface BotState {
  cooldown: number;
  /** Where it is steering, in field coordinates. */
  wantX: number;
  wantY: number;
  /**
   * Which drifter it settled on last time it looked, or −1.
   *
   * Kept so the bot can be *committed* rather than merely quick. Scoring from scratch every
   * decision made the fastest tier the worst player: `hard` re-picked every 0.06 s, and when
   * two stars scored within a few points of each other it steered at whichever was ahead
   * that frame, crossing back and forth and reaching neither. It caught the same as `normal`
   * while scoring a third less by ten seconds. A quick look is only an advantage if it can
   * confirm a plan as well as change one.
   */
  target: number;
}

export function createBotState(): BotState {
  return { cooldown: 0, wantX: FIELD_WIDTH / 2, wantY: FIELD_HEIGHT / 2, target: -1 };
}

export function resetBotState(state: BotState): void {
  state.cooldown = 0;
  state.wantX = FIELD_WIDTH / 2;
  state.wantY = FIELD_HEIGHT / 2;
  state.target = -1;
}

/**
 * How far a bot's reaction wanders, and how many values it draws to do it.
 *
 * **Each seat draws from its own generator** (see `StarCatcherGame`), which is the second
 * half of the same lesson as the sky's stream. Sharing one generator between the two bots
 * and drawing a constant number of values per decision is *not* enough: whichever seat is
 * asked first still takes the earlier value every time, and over two thousand matches that
 * was worth 1.4 points of win rate to the seat that drew second — 47.7/49.2/48.6 per cent to
 * seat one at the three tiers. Reversing the order of the two calls mirrored the result
 * exactly (52.3/50.8/51.4), which is how the artefact was identified as draw order rather
 * than anything in the rules. With a stream each, the order the seats are polled in cannot
 * be observed at all.
 *
 * **Two identical bots fly identical skies from an identical start**, so without a wander
 * they steer the same course and finish level every single match — the fourth time this
 * repo has met that shape, after Robot Arena, Slot Cars and Broken Tiles. The wander is in
 * *when* it looks, which is what separates two people of the same ability, and it is one
 * draw, unconditionally.
 */
export const REACTION_WANDER = 0.12;

/**
 * Values a bot draws per decision. Always exactly this many.
 *
 * One for the reaction, one for the aim. The bots share the game's `Rng` with the sky, so a
 * seat whose draw count depended on what it saw would shift the other seat's stream — the
 * seat bias made of arithmetic that Fruit Duel was caught by.
 */
export const BOT_DRAWS_PER_DECISION = 2;

/**
 * Where the bot steers. The caller feeds it to {@link driveNet}, so a bot is under the same
 * speed limit as a person.
 */
/**
 * How near a point passes to a line segment.
 *
 * The flight from the net to a star is a straight line, so what a hole costs is its distance
 * from that line — clamped to the segment, because a hole behind the net is not in the way.
 */
export function segmentGap(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

export function botTarget(
  game: Readonly<Game>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
  fixedDeltaSeconds: number,
  out: { x: number; y: number },
): void {
  state.cooldown -= fixedDeltaSeconds;
  if (state.cooldown > 0) {
    out.x = state.wantX;
    out.y = state.wantY;
    return;
  }
  // Both drawn before any branch on what it sees, so the count is constant.
  const wander = (rng.float() * 2 - 1) * REACTION_WANDER;
  const aimAngle = rng.float() * Math.PI * 2;
  const profile = BOT_PROFILES[difficulty];
  state.cooldown = profile.reaction * (1 + wander);

  const net = netOf(game, seat);
  const taken = takenBy(game, seat);
  let bestScore = -Infinity;
  let bestX = net.x;
  let bestY = net.y;
  let bestIndex = -1;

  for (let i = 0; i < game.drifters.length; i += 1) {
    const drifter = game.drifters[i] as Drifter;
    if (!drifter.active || drifter.hole || taken[i] === true) continue;

    // Where it will be when the net gets there — not where it will be in a fixed half second.
    //
    // `lead` used to be a flat number of seconds, and the tier with the most of it was the
    // worst player. A star two hundred units away takes the net most of a second to reach,
    // one just off the rim takes a tenth, and leading both by 0.45 s means aiming a long way
    // past the near one and nowhere near far enough ahead of the far one. Reading it as *how
    // much of the real intercept time the tier accounts for* makes more foresight strictly
    // better, which is what a difficulty axis has to be.
    const flight = Math.hypot(drifter.x - net.x, drifter.y - net.y) / NET_SPEED;
    const lead = flight * profile.lead;
    const aimX = drifter.x + drifter.vx * lead;
    const aimY = drifter.y + drifter.vy * lead;
    const distance = Math.hypot(aimX - net.x, aimY - net.y);
    // Too far across the sky for this tier to have noticed it yet.
    if (distance > profile.sight) continue;
    // Nearer is better; a star already halfway out of the sky is worth less than a fresh one.
    const leaving = drifter.vx > 0 ? FIELD_WIDTH - drifter.x : drifter.x;
    let score = -distance + leaving * LEAVE_WEIGHT;

    // And keep clear of any hole **on the way**, not merely at the far end.
    //
    // Measuring the gap at the aim point alone made the best-sighted tier the worst player:
    // seeing the whole sky, `hard` chased stars right across it, and the flight there ran
    // through everything in between. It caught the most (10.7 a match) and finished last,
    // because it also fell into 3.35 holes to `normal`'s 1.7. A star is only worth what the
    // trip costs, so the trip is what gets measured — the hole's distance from the line the
    // net would actually fly.
    for (const hazard of game.drifters) {
      if (!hazard.active || !hazard.hole) continue;
      const gap = segmentGap(net.x, net.y, aimX, aimY, hazard.x, hazard.y);
      const room = (NET_RADIUS + HOLE_RADIUS) * profile.caution;
      if (gap < room) score -= (room - gap) * AVOID_WEIGHT;
    }

    // Staying with a plan beats swapping to something barely better. Without this the
    // sharpest tier dithered; see `BotState.target`.
    if (i === state.target) score += STICKINESS;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
      bestX = aimX;
      bestY = aimY;
    }
  }

  // Nothing worth chasing: drift back to the middle, where the next star is nearest.
  if (bestScore === -Infinity) {
    bestX = FIELD_WIDTH / 2;
    bestY = FIELD_HEIGHT / 2;
  }
  state.target = bestIndex;

  // Nobody steers to the exact centre of anything, and how near the middle a tier gets is
  // the difficulty. It is also what separates two bots flying identical skies: without it,
  // twenty-seven per cent of `hard` matches were drawn.
  state.wantX = clamp(
    bestX + Math.cos(aimAngle) * profile.aim,
    NET_RADIUS,
    FIELD_WIDTH - NET_RADIUS,
  );
  state.wantY = clamp(
    bestY + Math.sin(aimAngle) * profile.aim,
    NET_RADIUS,
    FIELD_HEIGHT - NET_RADIUS,
  );
  out.x = state.wantX;
  out.y = state.wantY;
}
