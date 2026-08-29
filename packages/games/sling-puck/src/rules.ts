import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Sling Puck — one board, a wall across the middle with a gap in it, and pucks to be rid of.
 *
 * Everything here is in board units and nothing in this file knows what a pixel is (rule 8).
 * The board is **not** mirrored per seat: there is one coordinate system, p1 owns the low
 * half and p2 the high half, and the only thing that changes with the seat is which way
 * forward points. Two halves of one system rather than two systems is what lets the physics
 * be written once and the fairness argument be made by symmetry rather than by measurement.
 */

export const BOARD_WIDTH = 640;
export const BOARD_HEIGHT = 1000;
export const MID_Y = BOARD_HEIGHT / 2;

/** The wall across the middle, and the gap that makes the game a game. */
export const WALL_HALF_THICKNESS = 9;
/**
 * Half the width of the gap.
 *
 * The number that decides whether the game has a ceiling. At 62 the sharpest tier put a puck
 * through on 98 shots in 100, so both totals sat on the maximum and **three matches in four
 * were drawn** — a game where the best play is always available is not a difficult game, it
 * is a formality with a scoreboard. 36 puts the tiers at 0.35, 0.55 and 0.67 pucks a shot and
 * draws at one match in twenty. It is still 72 units against a 52-unit puck, so the shot is
 * threadable; it simply is not free.
 */
export const GAP_HALF_WIDTH = 36;
export const GAP_LEFT = BOARD_WIDTH / 2 - GAP_HALF_WIDTH;
export const GAP_RIGHT = BOARD_WIDTH / 2 + GAP_HALF_WIDTH;

export const PUCK_RADIUS = 26;

/**
 * How far behind the wall a puck that has gone through is racked up.
 *
 * A crossed puck used to stop wherever it stopped, which was hard against the far side of the
 * wall — and since a seat slings whatever of its own is nearest the gap, that arrival became
 * the follower's next shot, from a position with almost no angle left. It made **the first
 * shot of the match the only one taken at an undisturbed board**: seat one's opening shot went
 * through on 100 of 100, seat two's on 54, and every one of the other sixteen was level. That
 * one shot was the whole of a 54.5 per cent win rate over 1851 decided matches, and neither
 * alternating the lead nor an odd number of rounds could reach it, because both of those move
 * turns around and the advantage is in the board rather than the order.
 *
 * Racking the puck up at the back instead means no board is ever pristine and none is ever
 * jammed. The opponent still gains it — it is theirs to get through now — but as ammunition
 * rather than as an obstruction.
 */
export const PARK_DEPTH = 402;

/**
 * What a crossing is worth: three through the middle, two clean, one rattled.
 *
 * Three bands rather than two, because the score needs enough distinct values that two equal
 * players are unlikely to land on the same one. At a flat point a crossing, `hard` against
 * itself drew 947 matches in 2000; at two bands, 680 in 3000; at three, see SPEC.md. It also
 * puts precision on a gradient instead of a cliff — the gap leaves a 26-unit puck ten units
 * of clearance either side, and threading the middle third of that is a different act from
 * scraping through.
 */
export const CLEAN_WORTH = 2;
export const CENTRED_WORTH = 3;
/** How near the middle of the gap a crossing has to be to earn the top band. */
export const CENTRED_WINDOW = (GAP_HALF_WIDTH - PUCK_RADIUS) / 3;
/** How many each seat starts with, on its own side. */
export const PUCKS_PER_SEAT = 8;
export const PUCKS = PUCKS_PER_SEAT * 2;

/**
 * How many shots a seat gets in a whole match.
 *
 * **This is what ends the match**, and it is a count rather than a clock. Pucks go back and
 * forth through the same gap — that is the whole game — so no quantity in the position
 * decreases on its own and there is nothing else to exhaust. A budget of shots is the only
 * honest structural bound here.
 *
 * Nine rather than twelve. Twelve each ran 87 seconds against a 90-second round, which is not
 * a length, it is a coincidence waiting to become a bug report.
 *
 * **Odd, and that is the load-bearing part.** The lead alternates each round, so with an even
 * count seat one leads the first round *and* shoots the last shot of the last one — it gets
 * both ends, the only pristine board in the match and the final word. `hard` against itself
 * took 54.3 per cent of 1824 decided matches that way, at 3.7 standard deviations, with the
 * lead already alternating and the seats on separate generators. An odd count gives the first
 * shot to one seat and the last to the other.
 */
export const SHOTS_PER_SEAT = 7;

/** Speed below which a puck is stopped, in units a second. */
export const REST_SPEED = 14;
/**
 * What a puck keeps after a second of sliding.
 *
 * 0.16 left a full-power puck rolling for 2.2 seconds, and a shot is a needle sweep plus a
 * roll, so most of a match was spent watching. 0.06 stops it in 1.3 and reads as felt rather
 * than ice, which is what the board is meant to be.
 */
export const SLIDE_RETENTION = 0.06;
/**
 * How fast speed bleeds off, as the exponent behind {@link SLIDE_RETENTION}.
 *
 * `v(t) = v₀ · SLIDE_RETENTION^t` is the same statement as `v(t) = v₀ · e^(-SLIDE_RATE·t)`,
 * and having the rate as a number is what lets {@link slide} move a puck by the *integral*
 * of that decay rather than by `v · dt`. A puck slung at `v` covers exactly
 * `(v - REST_SPEED) / SLIDE_RATE` before it stops.
 */
export const SLIDE_RATE = -Math.log(SLIDE_RETENTION);
/** What is kept in a bounce off a rail or the wall. */
export const RAIL_BOUNCE = 0.72;
/** What is kept when two pucks meet. */
export const PUCK_BOUNCE = 0.94;

/**
 * Passes of the solver per frame.
 *
 * A puck at full power crosses 17 units a frame against a 26-unit radius, so at one pass two
 * pucks meeting head-on are resolved already overlapping by two thirds of a radius — which
 * reads as one jumping through the other rather than off it. Four passes puts the worst
 * overlap under a fifth of a radius, and eight measured no better.
 */
export const SUBSTEPS = 4;

/** The slowest and fastest a puck can be sent, in units a second. */
export const MIN_POWER = 290;
export const MAX_POWER = 1010;

/**
 * How far off straight the aim needle sweeps, in radians.
 *
 * The gap subtends about 0.24 rad from the middle of a seat's half, so a sweep of ±0.62
 * makes "somewhere in the gap" a little under a fifth of the arc: wide enough that stopping
 * the needle is a real act, narrow enough that missing it is a miss rather than a shot into
 * a corner.
 */
export const AIM_SPREAD = 0.62;
/** How fast each needle sweeps, in units of its own range a second. */
export const AIM_RATE = 1.35;
export const POWER_RATE = 1.15;

/**
 * A still moment at the start of every turn, before the needle starts sweeping.
 *
 * The board turns to face whoever is shooting, and a needle moving under a player who is
 * reading it means a tap names a moment they did not mean — so the shell refuses input while
 * it turns. A bot that does not go through the shell is not refused, which hands it the first
 * third of a second of every turn. Cannon Duel has that asymmetry and tolerates it because
 * its needle sweeps forever; here the needle is the *whole* shot, so a third of a second is a
 * measurable edge.
 *
 * Freezing the needle in the presentation layer instead would be worse: `seatView` reports no
 * rotation in single-seat play, so the same match would step differently on two devices. A
 * pause that lives in the pure rules and is longer than the turn cannot do that.
 */
export const READY_SECONDS = 0.45;

export type Phase = 'aim' | 'power' | 'sliding' | 'over';

export interface Puck {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Whose it is. A seat only ever slings its own. */
  readonly owner: SeatId;
  /**
   * Through the gap, and out of the game.
   *
   * **The two sides do not interact, and that is a decision rather than an oversight.** The
   * first design let a crossed puck stay in play as the opponent's problem, which is the real
   * table game — and turn by turn it does not work. Score the position and neither seat makes
   * progress: a puck slung over comes straight back, two equal bots spent 87 seconds arriving
   * at the same count, one match in five was drawn and `normal` beat `hard` 57–43 because the
   * better player handed the better opponent more to work with. Score the crossings instead
   * and the arriving puck lands hard against the far side of the wall, where it becomes the
   * follower's next shot from a position with no angle left — worth 46 points of first-shot
   * success and a 54.5 per cent win rate that neither alternating the lead nor an odd round
   * count could touch, because the advantage was in the board and not in the order.
   *
   * A parallel race is what the archetype already does here — darts and bowling are both two
   * players taking the same shot at their own target — and it is fair by construction rather
   * than by measurement.
   */
  through: boolean;
  /**
   * Whether it has got this far without touching a post or a rail on this shot.
   *
   * A crossing that threads the gap is worth two and one that rattles through is worth one,
   * which is what stops the score having so few values that equal players tie. At seven shots
   * and a flat point each, `hard` against itself drew 947 matches in 2000: two good players
   * both landed on five or six and there was nothing left to separate them. It is also the
   * only place precision pays *beyond* going through at all — the gap gives a 36-unit puck
   * ten units of clearance either side, so threading it is a real distinction and not a
   * rounding of one.
   */
  clean: boolean;
}

export interface Game {
  readonly pucks: Puck[];
  active: SeatId;
  /**
   * Which seat shoots first this round, and it changes every round.
   *
   * Shooting second means shooting at a board the other player has just disturbed — their
   * crossed puck arrives on your side, usually hard against the wall where the angle to the
   * gap is worst. Measured over 300 matches of `hard` against itself, the seat that led every
   * round put 6.96 pucks through to the follower's 6.52, and took 79 per cent of the decided
   * matches. Alternating the lead is the same fix Hammer Hit needed, for the same reason.
   */
  lead: SeatId;
  phase: Phase;
  /** Where the sweeping needle is, 0..1, read as an angle or a strength when it is stopped. */
  sweep: number;
  sweepUp: boolean;
  /** The angle the first press chose, held while the strength needle sweeps. */
  aim: number;
  p1Shots: number;
  p2Shots: number;
  /**
   * Pucks each seat has put through the gap, over the whole match.
   *
   * **The score is crossings, not what is left on your side**, and that is the difference
   * between a game and a stalemate. Scoring the position meant a puck slung over was slung
   * straight back, nothing decreased, and two equal bots spent 87 seconds arriving at the
   * same count: one match in five was drawn and `normal` beat `hard` 57–43, because the
   * better player simply handed the better opponent more to work with.
   *
   * Counting crossings makes every shot worth something it cannot lose again, and turns the
   * pucks coming back into the thing they should have been all along — ammunition.
   */
  p1Through: number;
  p2Through: number;
  /** Which puck the active seat will sling, or −1 when its side is already clear. */
  loaded: number;
  /** Seconds left of the still moment before the needle starts. */
  ready: number;
}

export function createGame(): Game {
  const pucks: Puck[] = [];
  for (let i = 0; i < PUCKS; i += 1) {
    pucks.push({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      owner: i < PUCKS_PER_SEAT ? 'p1' : 'p2',
      through: false,
      clean: true,
    });
  }
  return {
    pucks,
    active: 'p1',
    lead: 'p1',
    phase: 'aim',
    sweep: 0,
    sweepUp: true,
    aim: 0,
    p1Shots: 0,
    p2Shots: 0,
    p1Through: 0,
    p2Through: 0,
    loaded: -1,
    ready: READY_SECONDS,
  };
}

/** Which way forward is: p1 shoots towards the high half, p2 towards the low. */
export function forwardOf(seat: SeatId): number {
  return seat === 'p1' ? 1 : -1;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** Whether a point is on a seat's own side of the wall. */
export function ownSide(seat: SeatId, y: number): boolean {
  return seat === 'p1' ? y < MID_Y : y > MID_Y;
}

/**
 * The rack: five a side, in the same shape either way up.
 *
 * Built from the symmetry rather than chosen — every puck is placed at a distance from the
 * middle and mirrored — so the position a seat faces at the start is exactly the position the
 * other seat faces, turned round. It cannot drift out of that by being edited.
 */
/**
 * The opener is the shell's `context.openingSeat`, never a literal `p1`: the SDK alternates
 * it across the rounds of a best-of so first-mover advantage washes out (#2466), and a game
 * that assumed seat one would leave that rotation reaching nothing. The default exists only
 * so the rules tests can name a concrete side.
 */
export function resetGame(game: Game, opener: SeatId = 'p1'): void {
  /**
   * Every puck here can be pointed at the gap, and that is a constraint, not a layout.
   *
   * The first rack put two pucks 88 across at 96 back, which is 0.74 rad off straight — wider
   * than the needle's own 0.62 sweep. They could not be aimed at the gap **at all**, by anyone,
   * and since the rack empties from the front they were always the second shot: crossings on
   * shot two measured 0.20 against 0.96 either side of it, at every tier. A control a player
   * cannot reach the answer with is not a hard shot, it is a broken one. `rules.test.ts`
   * checks the whole rack against the sweep rather than trusting these numbers.
   */
  const rows: readonly { back: number; across: readonly number[] }[] = [
    { back: 130, across: [-60, 60] },
    { back: 210, across: [-98, 98] },
    { back: 290, across: [-120, 120] },
    { back: 368, across: [-42, 42] },
  ];
  let index = 0;
  for (const seat of ['p1', 'p2'] as SeatId[]) {
    const sign = forwardOf(seat);
    for (const row of rows) {
      for (const across of row.across) {
        const puck = game.pucks[index] as Puck;
        puck.x = BOARD_WIDTH / 2 + across;
        puck.y = MID_Y - sign * row.back;
        puck.vx = 0;
        puck.vy = 0;
        puck.through = false;
        puck.clean = true;
        index += 1;
      }
    }
  }
  game.active = opener;
  game.lead = opener;
  game.phase = 'aim';
  game.sweep = 0;
  game.sweepUp = true;
  game.aim = 0;
  game.p1Shots = 0;
  game.p2Shots = 0;
  game.p1Through = 0;
  game.p2Through = 0;
  game.loaded = pickLoaded(game, opener);
  game.ready = READY_SECONDS;
}

/** How many of a seat's pucks are still waiting to be slung. */
export function onSideOf(game: Readonly<Game>, seat: SeatId): number {
  let count = 0;
  for (const puck of game.pucks) if (puck.owner === seat && !puck.through) count += 1;
  return count;
}

/**
 * Which puck a seat slings: the one **nearest** the gap on its own side.
 *
 * Deliberately not a choice. A seat picking its own puck would be choosing among five
 * positions as well as an angle, and the interesting decision here is the angle. Keeping the
 * whole game inside two presses is also what makes a key and a thumb identical instruments
 * (rule 10).
 *
 * It was the rearmost puck first, on the reasoning that it had the clearest run. It has the
 * *worst*: two rows of its own side sit between it and the gap, so the shot that mattered was
 * decided by what it clipped on the way rather than by where it was pointed. All three tiers
 * put 0.30 to 0.32 pucks through a shot and `easy` beat `normal` — the aim was not reaching
 * the answer. The nearest puck has an open lane, which is what makes the angle worth
 * choosing, and it empties the rack from the front so the next shot has one too.
 */
export function pickLoaded(game: Readonly<Game>, seat: SeatId): number {
  let best = -1;
  let bestDepth = Infinity;
  for (let i = 0; i < game.pucks.length; i += 1) {
    const puck = game.pucks[i] as Puck;
    if (puck.owner !== seat || puck.through) continue;
    const depth = seat === 'p1' ? MID_Y - puck.y : puck.y - MID_Y;
    if (depth >= bestDepth) continue;
    bestDepth = depth;
    best = i;
  }
  return best;
}

/** The angle a sweep of `s` in 0..1 means for a seat. Straight ahead is the middle. */
export function angleOf(seat: SeatId, sweep: number): number {
  const forward = forwardOf(seat);
  const base = forward > 0 ? Math.PI / 2 : -Math.PI / 2;
  return base + (sweep * 2 - 1) * AIM_SPREAD;
}

/** The speed a sweep of `s` in 0..1 means. */
export function powerOf(sweep: number): number {
  return MIN_POWER + sweep * (MAX_POWER - MIN_POWER);
}

/**
 * One frame.
 *
 * `press` is the seat asking to stop the needle, or null. It is answered only when it is that
 * seat's turn, so a press from the waiting seat is not an error — it is simply nothing, which
 * is what a shared board needs, since both thumbs are on the same glass.
 */
export function step(game: Game, fixedDeltaSeconds: number, press: SeatId | null): void {
  if (game.phase === 'over') return;

  if (game.phase === 'sliding') {
    slide(game, fixedDeltaSeconds);
    if (!moving(game)) handOver(game);
    return;
  }

  if (game.ready > 0) {
    game.ready -= fixedDeltaSeconds;
    return;
  }

  const rate = game.phase === 'aim' ? AIM_RATE : POWER_RATE;
  game.sweep += (game.sweepUp ? 1 : -1) * rate * fixedDeltaSeconds;
  if (game.sweep >= 1) {
    game.sweep = 1;
    game.sweepUp = false;
  } else if (game.sweep <= 0) {
    game.sweep = 0;
    game.sweepUp = true;
  }

  if (press !== game.active) return;

  if (game.phase === 'aim') {
    game.aim = angleOf(game.active, game.sweep);
    game.phase = 'power';
    game.sweep = 0;
    game.sweepUp = true;
    return;
  }

  const speed = powerOf(game.sweep);
  for (const each of game.pucks) each.clean = true;
  const puck = game.pucks[game.loaded];
  if (puck !== undefined) {
    puck.vx = Math.cos(game.aim) * speed;
    puck.vy = Math.sin(game.aim) * speed;
  }
  if (game.active === 'p1') game.p1Shots += 1;
  else game.p2Shots += 1;
  game.phase = 'sliding';
}

/**
 * A puck has cleared the wall: score it and take it off the table, **at once**.
 *
 * Not when the shot settles, which is what it used to be, and the difference is the last seat
 * bias in the game. A puck credited at the end of the shot spends the rest of that shot
 * *inside the opponent's rack*, scattering it — so the two sides interacted after all, and the
 * seat that shot first met an untouched rack while its opponent met a disturbed one. It was
 * worth a quarter of a point a match and 55 per cent of decided matches at every tier, and it
 * survived alternating the lead, an odd round count and separate generators per seat, because
 * none of those touch the board.
 *
 * Taken at the wall, neither board can reach the other and the seats are equal by
 * construction rather than by measurement.
 */
function cross(game: Game, puck: Puck): void {
  puck.through = true;
  const centred = Math.abs(puck.x - BOARD_WIDTH / 2) <= CENTRED_WINDOW;
  const worth = !puck.clean ? 1 : centred ? CENTRED_WORTH : CLEAN_WORTH;
  if (puck.owner === 'p1') game.p1Through += worth;
  else game.p2Through += worth;
  park(game, puck, otherOf(puck.owner));
}

/**
 * Rack a crossed puck up at the back of the side it arrived on.
 *
 * The slot is the first across the board that nothing else is near, walked from the middle
 * outwards, so the rack fills the way a person would fill it and two pucks never land on each
 * other. Deterministic, and identical either way up.
 */
function park(game: Game, puck: Puck, seat: SeatId): void {
  const y = MID_Y - forwardOf(seat) * PARK_DEPTH;
  const step = PUCK_RADIUS * 2 + 6;
  for (let slot = 0; slot < 9; slot += 1) {
    // 0, +1, −1, +2, −2 … out from the middle.
    const offset = (slot % 2 === 0 ? 1 : -1) * Math.ceil(slot / 2) * step;
    const x = BOARD_WIDTH / 2 + offset;
    if (x < PUCK_RADIUS || x > BOARD_WIDTH - PUCK_RADIUS) continue;
    let free = true;
    for (const other of game.pucks) {
      if (other === puck || !other.through) continue;
      if (Math.hypot(other.x - x, other.y - y) < PUCK_RADIUS * 2) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    puck.x = x;
    puck.y = y;
    puck.vx = 0;
    puck.vy = 0;
    return;
  }
}

function moving(game: Readonly<Game>): boolean {
  for (const puck of game.pucks) if (!puck.through && (puck.vx !== 0 || puck.vy !== 0)) return true;
  return false;
}

/**
 * Pass the turn, and decide whether there is still a match.
 *
 * **The win is only read once both seats have had the same number of shots.** A seat that
 * clears its side on its twelfth has not beaten an opponent who has had eleven — the same
 * rule Knife Thrower needed, for the same reason: a race in which one racer starts first is
 * not a race.
 */
function handOver(game: Game): void {
  // The lead shoots, then the follower, then the lead changes hands.
  const roundOver = game.active !== game.lead;
  if (roundOver) game.lead = otherOf(game.lead);
  const next = roundOver ? game.lead : otherOf(game.active);
  game.active = next;
  game.phase = 'aim';
  game.sweep = 0;
  game.sweepUp = true;
  game.loaded = pickLoaded(game, next);
  game.ready = READY_SECONDS;

  if (game.p1Shots >= SHOTS_PER_SEAT && game.p2Shots >= SHOTS_PER_SEAT) game.phase = 'over';
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  if (game.phase !== 'over') return null;
  if (game.p1Through > game.p2Through) return 'p1';
  if (game.p2Through > game.p1Through) return 'p2';
  return 'draw';
}

/**
 * Move one puck by the analytic integral of its own decay, rather than by `v · dt`.
 *
 * `v · dt` is the rectangle rule under a curve that is falling all the way across the pass,
 * so it overshoots by `dt · SLIDE_RATE / 2` — 0.59% a frame here, measured, held down that
 * far only by the four substeps. The decay itself was already step-size exact; only the
 * travel was not. Under `v(t) = v₀ · SLIDE_RETENTION^t` a puck covers
 * `(v_before - v_after) / SLIDE_RATE` in a pass, and those terms telescope, so a free slide
 * totals `(v₀ - REST_SPEED) / SLIDE_RATE` however finely it is sliced — which also means
 * the substep count no longer changes where a puck ends up.
 *
 * The last pass is coasted to the rest line rather than truncated at it, so where a puck
 * finishes does not depend on which pass happened to cross it. Soccer Pool's `step` is the
 * same three branches for the same reason.
 *
 * Allocation-free (CLAUDE.md rule 5): scalars only, and the puck is written in place.
 */
function coast(puck: Puck, keep: number): void {
  const speed = Math.hypot(puck.vx, puck.vy);
  if (speed === 0) return;
  if (speed <= REST_SPEED) {
    puck.vx = 0;
    puck.vy = 0;
    return;
  }
  const ux = puck.vx / speed;
  const uy = puck.vy / speed;
  const next = speed * keep;
  if (next <= REST_SPEED) {
    const travel = (speed - REST_SPEED) / SLIDE_RATE;
    puck.x += ux * travel;
    puck.y += uy * travel;
    puck.vx = 0;
    puck.vy = 0;
    return;
  }
  const travel = (speed - next) / SLIDE_RATE;
  puck.x += ux * travel;
  puck.y += uy * travel;
  puck.vx = ux * next;
  puck.vy = uy * next;
}

/**
 * One frame of sliding, in `SUBSTEPS` passes.
 *
 * The move is {@link coast} — the integral of the drag, not `v · dt`. See its note.
 */
function slide(game: Game, fixedDeltaSeconds: number): void {
  const dt = fixedDeltaSeconds / SUBSTEPS;
  const keep = Math.pow(SLIDE_RETENTION, dt);
  for (let pass = 0; pass < SUBSTEPS; pass += 1) {
    for (const puck of game.pucks) {
      // A puck that is through is racked and out of the way; nothing may disturb it, and it
      // may not disturb anything, or the two races would touch after all.
      if (puck.through) continue;
      coast(puck, keep);
      bounceRails(puck);
      bounceWall(puck);
      if (!ownSide(puck.owner, puck.y)) cross(game, puck);
    }
    separate(game);
  }
}

function bounceRails(puck: Puck): void {
  const before = { x: puck.x, y: puck.y };
  if (puck.x < PUCK_RADIUS) {
    puck.x = PUCK_RADIUS;
    puck.vx = Math.abs(puck.vx) * RAIL_BOUNCE;
  } else if (puck.x > BOARD_WIDTH - PUCK_RADIUS) {
    puck.x = BOARD_WIDTH - PUCK_RADIUS;
    puck.vx = -Math.abs(puck.vx) * RAIL_BOUNCE;
  }
  if (puck.y < PUCK_RADIUS) {
    puck.y = PUCK_RADIUS;
    puck.vy = Math.abs(puck.vy) * RAIL_BOUNCE;
  } else if (puck.y > BOARD_HEIGHT - PUCK_RADIUS) {
    puck.y = BOARD_HEIGHT - PUCK_RADIUS;
    puck.vy = -Math.abs(puck.vy) * RAIL_BOUNCE;
  }
  if (puck.x !== before.x || puck.y !== before.y) puck.clean = false;
}

/**
 * The middle wall, as two boxes with a gap between them.
 *
 * The gap's ends are **round posts** rather than square corners. A square corner catches a
 * puck moving nearly along the wall and throws it straight back, which reads as a bug even
 * when the arithmetic is right; a post gives the glancing shot the deflection a player
 * expects, and makes threading the gap at an angle a skill rather than a lottery.
 */
function bounceWall(puck: Puck): void {
  if (Math.abs(puck.y - MID_Y) > WALL_HALF_THICKNESS + PUCK_RADIUS) return;

  if (puck.x > GAP_LEFT && puck.x < GAP_RIGHT) {
    for (const post of [GAP_LEFT, GAP_RIGHT]) {
      const dx = puck.x - post;
      const dy = puck.y - MID_Y;
      const distance = Math.hypot(dx, dy);
      if (distance >= PUCK_RADIUS || distance === 0) continue;
      const nx = dx / distance;
      const ny = dy / distance;
      puck.x = post + nx * PUCK_RADIUS;
      puck.y = MID_Y + ny * PUCK_RADIUS;
      puck.clean = false;
      const into = puck.vx * nx + puck.vy * ny;
      if (into >= 0) continue;
      puck.vx -= (1 + RAIL_BOUNCE) * into * nx;
      puck.vy -= (1 + RAIL_BOUNCE) * into * ny;
    }
    return;
  }

  const above = puck.y < MID_Y;
  puck.y = MID_Y + (above ? -1 : 1) * (WALL_HALF_THICKNESS + PUCK_RADIUS);
  puck.vy = (above ? -1 : 1) * Math.abs(puck.vy) * RAIL_BOUNCE;
  puck.clean = false;
}

/** Puck against puck: equal masses, so the exchange is along the line of centres. */
function separate(game: Game): void {
  const pucks = game.pucks;
  for (let i = 0; i < pucks.length; i += 1) {
    const a = pucks[i] as Puck;
    if (a.through) continue;
    for (let j = i + 1; j < pucks.length; j += 1) {
      const b = pucks[j] as Puck;
      if (b.through) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy);
      if (distance >= PUCK_RADIUS * 2 || distance === 0) continue;

      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = PUCK_RADIUS * 2 - distance;
      a.x -= nx * overlap * 0.5;
      a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.y += ny * overlap * 0.5;

      const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (closing >= 0) continue;
      a.clean = false;
      b.clean = false;
      const impulse = -(1 + PUCK_BOUNCE) * closing * 0.5;
      a.vx -= impulse * nx;
      a.vy -= impulse * ny;
      b.vx += impulse * nx;
      b.vy += impulse * ny;
    }
  }
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * How far off the angle it means to take, in radians.
   *
   * The knob that decides whether a shot goes through at all — and unlike a wander smaller
   * than its target, every value here is comparable to the 0.24 rad the gap subtends, so it
   * is a live knob at all three tiers rather than a number that reads like one.
   */
  readonly aim: number;
  /** How far off the strength it means to take, as a fraction of the range. */
  readonly power: number;
  /**
   * Whether it works out how hard to hit: 0 slings everything at a flat three-quarters, 1
   * computes the strength the distance actually needs.
   */
  readonly reads: number;
}

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { aim: 0.3, power: 0.34, reads: 0 },
  normal: { aim: 0.13, power: 0.17, reads: 0.55 },
  hard: { aim: 0.045, power: 0.07, reads: 1 },
});

/** How many values a bot draws per needle, whatever it decides. Asserted by a test. */
export const BOT_DRAWS_PER_NEEDLE = 2;

export interface BotState {
  /** The sweep value it is waiting for, or −1 when it has not chosen for this needle yet. */
  want: number;
}

export function createBotState(): BotState {
  return { want: -1 };
}

export function resetBotState(state: BotState): void {
  state.want = -1;
}

/**
 * Whether the bot presses this frame.
 *
 * It picks a value once per needle and then waits for the needle to reach it, which is what a
 * person does. It gets no extra looks and no finer resolution than the frame it is shown, so
 * it cannot stop the needle anywhere a person could not (rule 6). Both draws happen before
 * any branch on the board, so the count per needle is constant.
 */
export function botPress(
  game: Readonly<Game>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
): boolean {
  if (game.active !== seat || (game.phase !== 'aim' && game.phase !== 'power')) {
    state.want = -1;
    return false;
  }
  // The still moment is still, for the bot too. See `READY_SECONDS`.
  if (game.ready > 0) return false;

  if (state.want < 0) {
    const profile = BOT_PROFILES[difficulty];
    // Both drawn unconditionally, before anything about the board is looked at.
    const slipAim = (rng.float() * 2 - 1) * profile.aim;
    const slipPower = (rng.float() * 2 - 1) * profile.power;
    state.want =
      game.phase === 'aim'
        ? clamp01(sweepForAngle(game, seat) + slipAim / (AIM_SPREAD * 2))
        : clamp01(sweepForPower(game, difficulty) + slipPower);
  }

  const rate = game.phase === 'aim' ? AIM_RATE : POWER_RATE;
  if (Math.abs(game.sweep - state.want) > rate / 60) return false;
  // Cleared here, not by the caller. Left standing, the value chosen for the angle needle was
  // still sitting there when the strength needle started, so the bot stopped the second
  // needle at the first one's answer — a number in a different unit with a different meaning.
  state.want = -1;
  return true;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** The sweep value that points the loaded puck at the gap. */
function sweepForAngle(game: Readonly<Game>, seat: SeatId): number {
  const puck = game.pucks[game.loaded];
  if (puck === undefined) return 0.5;
  // The middle of the gap, and nothing cleverer.
  //
  // A tier that "read the board" and shifted its target away from its own nearby pucks lived
  // here for a while. It cost, rather than paid: the gap is 72 units wide against a 52-unit
  // puck, so a shift of even twenty units aims at a post, and the shift was twenty-two. The
  // loading rule already hands every shot a clear lane — nothing on this side is nearer the
  // gap than the puck being slung — so there was never anything for it to dodge. Crossings
  // went from 0.67 a shot to 0.55 with it switched on. Deleted rather than tuned to zero: a
  // knob that reads like skill and is not one is worse than no knob at all.
  const angle = Math.atan2(MID_Y - puck.y, BOARD_WIDTH / 2 - puck.x);
  const base = forwardOf(seat) > 0 ? Math.PI / 2 : -Math.PI / 2;
  let delta = angle - base;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return clamp01((delta / AIM_SPREAD + 1) / 2);
}

/**
 * How hard it hits.
 *
 * Enough to clear the gap and not so much that the puck returns off the far rail. A tier that
 * reads nothing simply hits everything at three-quarters and lives with the consequences.
 */
function sweepForPower(game: Readonly<Game>, difficulty: BotDifficulty): number {
  const reads = BOT_PROFILES[difficulty].reads;
  if (reads <= 0) return 0.75;
  const puck = game.pucks[game.loaded];
  if (puck === undefined) return 0.6;
  const run = Math.abs(MID_Y - puck.y) + 210;
  const wanted = Math.sqrt(run * 2 * SLIDE_RATE * (MIN_POWER + MAX_POWER) * 0.5);
  const sweep = (wanted - MIN_POWER) / (MAX_POWER - MIN_POWER);
  return clamp01(0.6 + (clamp01(sweep) - 0.6) * reads);
}
