import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Lumberjack, as pure rules.
 *
 * Two woodcutters, a tree each, an axe apiece. Chop from the left or from the right; every
 * swing takes a log off the foot of your trunk and drops the whole tree one notch onto
 * you. What lands at your shoulder is what you must not be standing under — a branch on
 * your side clouts you flat, and the seconds spent on your back are seconds the other
 * player is still swinging. First to sixty logs wins.
 *
 * Three decisions shape everything below, and each is argued where it lives:
 *
 *  - **Each seat fells its own tree** ({@link Match}). No shared resource and no turn
 *    order, so neither seat can take anything from the other: the two halves are one game
 *    played twice at once. Structural fairness rather than tuned fairness.
 *  - **Both seats are handed the identical trunk** ({@link fillTrunk}). One seeded
 *    sequence read by both, so a match is never decided by one player drawing the kinder
 *    tree.
 *  - **The axe has a cadence, and the cadence quickens** ({@link swingSeconds}). A swing
 *    takes time and no input can make it take less, which is what keeps a thumb and a key
 *    equal; and it shortens with every clean swing, which is what ends the match.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit and every duration is
 * in simulated seconds.
 */

/** The logical box the yard is drawn into. Declared here so the manifest cannot drift. */
export const YARD_WIDTH = 600;
export const YARD_HEIGHT = 1000;

/**
 * What one segment of trunk carries.
 *
 * A branch out of its left side, out of its right side, or neither. Never both: a segment
 * branched both ways would be unavoidable, and a rule a player cannot play around is not
 * a rule, it is a coin toss.
 */
export const CLEAR = 0;
export const LEFT = -1;
export const RIGHT = 1;

export type Side = typeof LEFT | typeof RIGHT;
/** A side, or {@link CLEAR} for "no branch" and for "this seat has asked for nothing". */
export type Lean = typeof CLEAR | Side;

/** How many segments of trunk a player can see above their own shoulder. */
export const VISIBLE_SEGMENTS = 7;

/** Logs that win the match. */
export const TARGET_LOGS = 60;

/**
 * The match is called on logs after this long.
 *
 * A second guarantee behind the first. Sixty logs ends a match between two players who
 * are playing; this ends one where nobody touches a key, which is otherwise a game that
 * runs for ever — nothing in this simulation moves on its own, so an untouched match is
 * a still picture. `roundSeconds` in the manifest ends nothing at all, it only prints a
 * number on the catalogue card, so the guarantee has to live here. See the note at the
 * top of `termination.test.ts`.
 *
 * Deliberately far above what a match takes: the slowest pairing measured, two `easy`
 * bots, averages 33 s and the longest of 150 ran 39 s. This is a backstop, not a clock
 * anybody plays against.
 */
export const ROUND_SECONDS = 120;

/**
 * Segments in the generated trunk.
 *
 * A seat reads from its own count up to {@link VISIBLE_SEGMENTS} further on, and the
 * match stops the instant a count reaches {@link TARGET_LOGS}, so this is the furthest
 * index anybody can ever ask for, plus two for comfort.
 */
export const TRUNK_LENGTH = TARGET_LOGS + VISIBLE_SEGMENTS + 2;

/** The first few segments are always clear, so nobody is clouted before they have looked. */
export const CALM_SEGMENTS = 4;

/** How often a segment carries a branch at the foot of the tree, and at the top. */
export const BRANCH_FLOOR = 0.34;
export const BRANCH_CEILING = 0.86;
/** Added to the chance per segment, so the tree thickens as the match runs. */
export const BRANCH_RAMP = 0.014;

/**
 * How likely the segment at `index` is to carry a branch.
 *
 * The ramp is half the difficulty curve. At the foot of the tree a third of segments are
 * branched and the other two thirds are a free choice — stand where you are and keep
 * swinging. By the thirty-eighth the figure is at its ceiling and nearly every swing is
 * forced. The cadence shortens over the same stretch, so a clean run gets harder in two
 * unrelated ways at once: less time to read, and more to read.
 */
export function branchChanceAt(index: number): number {
  const chance = BRANCH_FLOOR + index * BRANCH_RAMP;
  return chance > BRANCH_CEILING ? BRANCH_CEILING : chance;
}

/**
 * Fill a trunk from the seeded generator.
 *
 * **One trunk, read by both seats.** Two independently generated trees would be fair only
 * on average, and a party game is played once: a player who drew four forced switches in
 * a row while their opponent drew four clear segments has lost to the seed rather than to
 * the other player. Handing both seats the identical sequence deletes the question, and
 * it is what makes this a race rather than two solo score attacks shown side by side.
 *
 * The leader's half does show the trailing player a few segments they have not reached —
 * but only ever fewer than the seven they can already see on their own tree, because a
 * player seven logs behind has lost anyway. Nothing is leaked that reading your own tree
 * would not tell you sooner.
 *
 * Two draws per segment, always, whether or not the first produces a branch. Drawing the
 * side only when it is needed works — the stream is deterministic either way — but it
 * couples the sequence of sides to the sequence of densities, so a tuning change to the
 * ramp would silently rearrange every tree in the game.
 */
export function fillTrunk(trunk: Int8Array, rng: Rng): void {
  for (let index = 0; index < trunk.length; index += 1) {
    const roll = rng.float();
    const side = rng.float() < 0.5 ? LEFT : RIGHT;
    trunk[index] = index < CALM_SEGMENTS || roll >= branchChanceAt(index) ? CLEAR : side;
  }
}

/** The segment at `index`, or {@link CLEAR} past the end of the trunk. */
export function segmentAt(trunk: Int8Array, index: number): number {
  return trunk[index] ?? CLEAR;
}

/**
 * Seconds a swing takes with no rhythm at all, and with all of it.
 *
 * **The cadence is what makes this game fair across input families.** The genre's own
 * instruction is "tap the left or right side", and a game where taps land logs is won by
 * whoever's instrument repeats fastest — a keyboard, always, by a margin no shared
 * viewport or precision envelope closes. Road Dodge met the same wall and answered it by
 * declaring `sameInputClassOnly`, which is the honest answer for a game whose whole
 * interaction is rapid discrete input.
 *
 * This one does not need to. A swing takes {@link swingSeconds} whatever asked for it, so
 * a tap beyond the cadence buys nothing, and a side held down — a finger resting on the
 * glass, a key held — keeps swinging at exactly that rate. What is left to be good at is
 * *which side*, which a thumb and a key express equally well. **[ours]**
 *
 * The fast end is past what any person can hold, and that is the point rather than an
 * oversight: it is a limit the ramp walks you towards, not a target. Everyone finds their
 * own ceiling somewhere on the way up, which is what the whole design is for.
 */
export const SWING_SLOW = 0.46;
export const SWING_FAST = 0.11;

/** Clean swings in a row before the axe is at its fastest. */
export const STREAK_FULL = 20;

/**
 * How long the next swing takes, after `streak` clean ones.
 *
 * **This is the rule that ends the match, and it exists because a fixed cadence does
 * not.** A fixed cadence was the first draft, and it produced a game nobody could lose:
 * two competent players alternate correctly for sixty logs and finish within a step of
 * each other. Measured at a flat 0.30 s over 150 seeded matches a pairing, `hard` against
 * `hard` **drew 52 of 150**, `normal` against `normal` drew 27, and even `hard` against
 * `normal` — a pairing one side should win outright — drew 22.
 *
 * Quickening with the streak fixes it from both ends. The better you are doing, the less
 * time you have to read the next segment, so a clean run walks itself into a mistake; and
 * because a clout resets the streak, being caught costs a second and a half on your back
 * *and* the twenty swings it takes to get the tempo back. The second cost is much the
 * larger, and it is what turns a two-log lead into a decided match. The same 150 seeds
 * now draw **8**.
 *
 * Ramped on the streak rather than on the log count, which was the other candidate and is
 * quietly worse: a count ramp is identical for both seats at every moment, so it changes
 * when the match ends and never who wins it.
 */
export function swingSeconds(streak: number): number {
  const along = streak >= STREAK_FULL ? 1 : streak / STREAK_FULL;
  return SWING_SLOW + (SWING_FAST - SWING_SLOW) * along;
}

/** Seconds flat on your back after a branch catches you. */
export const STUN_SECONDS = 1.5;

export interface Woodsman {
  /** Which side of the trunk they are standing on. */
  side: Side;
  /** Logs felled. This is the score. */
  cut: number;
  /** Clean swings in a row, which is what sets the cadence. */
  streak: number;
  /** Seconds until the axe is ready. Zero means it may fall this step. */
  cooldown: number;
  /** What {@link Woodsman.cooldown} started at, so a renderer can show the swing. */
  span: number;
  /** True while they are on the ground rather than mid-swing. */
  stunned: boolean;
  /** Times a branch has caught them, for the HUD and for the balance harness. */
  clouts: number;
}

export function createWoodsman(): Woodsman {
  return {
    side: RIGHT,
    cut: 0,
    streak: 0,
    cooldown: SWING_SLOW,
    span: SWING_SLOW,
    stunned: false,
    clouts: 0,
  };
}

export function resetWoodsman(woodsman: Woodsman): void {
  woodsman.side = RIGHT;
  woodsman.cut = 0;
  woodsman.streak = 0;
  // A beat before the first swing, so a match does not open with a log already felled by
  // whichever finger happened to be resting on the glass as the countdown ended.
  woodsman.cooldown = SWING_SLOW;
  woodsman.span = SWING_SLOW;
  woodsman.stunned = false;
  woodsman.clouts = 0;
}

export type Phase = 'felling' | 'over';

export interface Match {
  /** The one trunk both seats are felling. Allocated once; refilled on reset. */
  readonly trunk: Int8Array;
  readonly p1: Woodsman;
  readonly p2: Woodsman;
  /** Simulated seconds the match has run, so it can be called. */
  elapsed: number;
  phase: Phase;
  winner: SeatId | 'draw' | null;
}

export function createMatch(): Match {
  return {
    trunk: new Int8Array(TRUNK_LENGTH),
    p1: createWoodsman(),
    p2: createWoodsman(),
    elapsed: 0,
    phase: 'felling',
    winner: null,
  };
}

/**
 * Put both seats back to the start, leaving the tree standing as it is.
 *
 * Separate from {@link resetMatch} because tearing a match down is not the same as
 * starting one: `destroy` has to leave nothing behind, but generating a fresh trunk on
 * the way out would spend draws from the host's generator after the match it belongs to
 * has finished.
 */
export function clearMatch(match: Match): void {
  resetWoodsman(match.p1);
  resetWoodsman(match.p2);
  match.elapsed = 0;
  match.phase = 'felling';
  match.winner = null;
}

/** Start a fresh match on a newly generated trunk. The only place the trunk is written. */
export function resetMatch(match: Match, rng: Rng): void {
  fillTrunk(match.trunk, rng);
  clearMatch(match);
}

export function woodsmanOf(match: Match, seat: SeatId): Woodsman {
  return seat === 'p1' ? match.p1 : match.p2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** How many logs a seat has felled. */
export function logsOf(match: Readonly<Match>, seat: SeatId): number {
  return seat === 'p1' ? match.p1.cut : match.p2.cut;
}

/**
 * The side that will be safe on this woodsman's next swing.
 *
 * Read off the segment one above their shoulder — the one the swing is about to drop onto
 * them. When it is clear either side does, and standing still is the cheapest answer.
 *
 * This is exactly what a player reads off the screen, and it is all the bot is allowed to
 * read either (rule 6): the bot sees one segment ahead where a person sees
 * {@link VISIBLE_SEGMENTS}, so if anything it is the worse informed of the two.
 */
export function safeSide(match: Readonly<Match>, seat: SeatId): Side {
  const woodsman = seat === 'p1' ? match.p1 : match.p2;
  const arriving = segmentAt(match.trunk, woodsman.cut + 1);
  if (arriving === LEFT) return RIGHT;
  if (arriving === RIGHT) return LEFT;
  return woodsman.side;
}

/**
 * Take one log off, from `side`.
 *
 * The segment being chopped goes, branch and all — which is why stepping across to the
 * side a branch is already on is allowed rather than fatal: you are cutting that branch
 * off. What can catch you is the segment that *drops*, and only that one. The rule is
 * small enough to be learned in a single mistake, which is what a party game gets.
 *
 * It also leaves a standing invariant a renderer can lean on: a woodsman who is still on
 * their feet is never on the same side as the branch at their own shoulder.
 *
 * @returns true when a branch caught them.
 */
export function chop(match: Match, seat: SeatId, side: Side): boolean {
  const woodsman = seat === 'p1' ? match.p1 : match.p2;
  woodsman.side = side;
  woodsman.cut += 1;

  const clouted = segmentAt(match.trunk, woodsman.cut) === side;
  if (clouted) {
    woodsman.streak = 0;
    woodsman.clouts += 1;
    woodsman.stunned = true;
    woodsman.span = STUN_SECONDS;
  } else {
    woodsman.streak += 1;
    woodsman.stunned = false;
    woodsman.span = swingSeconds(woodsman.streak);
  }
  woodsman.cooldown = woodsman.span;
  return clouted;
}

/** What one seat did this step. */
export type Swing = 'idle' | 'felled' | 'clouted';

export interface StepResult {
  readonly p1: Swing;
  readonly p2: Swing;
}

/** Rewritten in place rather than allocated, so a step costs no garbage (rule 5). */
const result: { p1: Swing; p2: Swing } = { p1: 'idle', p2: 'idle' };

/**
 * Run one seat's axe for a step.
 *
 * `wanted` is the side that seat is asking for, or {@link CLEAR} for nothing. Asking
 * early is free and does nothing — the cooldown is the only thing that releases a swing —
 * so a caller may keep asking on every step without changing the rate. That is what lets
 * a held key and a resting finger mean "keep chopping this side" without either becoming
 * faster than the other.
 */
export function stepWoodsman(
  match: Match,
  seat: SeatId,
  wanted: Lean,
  fixedDeltaSeconds: number,
): Swing {
  const woodsman = seat === 'p1' ? match.p1 : match.p2;
  if (woodsman.cut >= TARGET_LOGS) return 'idle';

  if (woodsman.cooldown > 0) {
    woodsman.cooldown -= fixedDeltaSeconds;
    if (woodsman.cooldown > 0) return 'idle';
    // Snapped rather than carried over, so the cadence is a floor a fixed step can land
    // on exactly and the swing a renderer draws never runs past its own end.
    woodsman.cooldown = 0;
    woodsman.stunned = false;
  }

  if (wanted === CLEAR) return 'idle';
  return chop(match, seat, wanted) ? 'clouted' : 'felled';
}

/**
 * One fixed step of the whole match.
 *
 * Both seats are stepped before either is judged, so a step in which both reach sixty is
 * the draw it actually is rather than a win for whichever seat the loop happened to run
 * first. Neither can reach sixty-one: the match is over the instant one of them arrives.
 */
export function stepMatch(
  match: Match,
  fixedDeltaSeconds: number,
  p1Wanted: Lean,
  p2Wanted: Lean,
): StepResult {
  result.p1 = 'idle';
  result.p2 = 'idle';
  if (match.phase === 'over') return result;

  match.elapsed += fixedDeltaSeconds;
  result.p1 = stepWoodsman(match, 'p1', p1Wanted, fixedDeltaSeconds);
  result.p2 = stepWoodsman(match, 'p2', p2Wanted, fixedDeltaSeconds);

  const p1Done = match.p1.cut >= TARGET_LOGS;
  const p2Done = match.p2.cut >= TARGET_LOGS;
  if (p1Done || p2Done) {
    match.phase = 'over';
    match.winner = p1Done && p2Done ? 'draw' : p1Done ? 'p1' : 'p2';
  } else if (match.elapsed >= ROUND_SECONDS) {
    callOnTime(match);
  }
  return result;
}

/**
 * Call the match on logs.
 *
 * Reached from {@link stepMatch} when the round clock expires, rather than left to the
 * host to remember: the rules own their own termination, so a game class that forgot to
 * check the clock could not produce a match that never ends.
 */
export function callOnTime(match: Match): void {
  if (match.phase === 'over') return;
  match.phase = 'over';
  match.winner = match.p1.cut === match.p2.cut ? 'draw' : match.p1.cut > match.p2.cut ? 'p1' : 'p2';
}

export function winnerOf(match: Readonly<Match>): SeatId | 'draw' | null {
  return match.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Seconds between looks at the tree. Between them it holds whatever side it last chose,
   * exactly as a player whose eyes are still on the previous segment would.
   */
  readonly reaction: number;
  /** Magnitude of the random extra added to that delay, so it is never metronomic. */
  readonly waver: number;
  /** Chance a look comes out the wrong way round — it read the branch on the wrong side. */
  readonly blunder: number;
}

/**
 * The three tiers, expressed only as reaction delay, error magnitude and blunder rate.
 *
 * No tier gets a faster axe, a longer look up the trunk, or anything a player cannot see
 * (rule 6). What separates them is how often they are still holding the previous
 * segment's answer when the axe comes down — and because the cadence quickens with the
 * streak, that is a trap the bot walks into by *doing well*. Measured average peak streak
 * per match: `easy` 13, `normal` 19, `hard` 27. Each tier climbs until the tree arrives
 * faster than it can read, and then falls off there.
 *
 * That self-limiting is why three numbers separate three tiers cleanly here, where Ping
 * Pong needed an ambition knob as well: the difficulty is not how accurately the bot
 * aims, it is whether it has looked recently enough to have an answer at all.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.44, waver: 0.26, blunder: 0.14 },
  normal: { reaction: 0.24, waver: 0.12, blunder: 0.05 },
  hard: { reaction: 0.13, waver: 0.05, blunder: 0.02 },
});

export interface BotState {
  /** Seconds until it looks at the tree again. */
  look: number;
  /** The side it settled on at the last look, which it holds until the next one. */
  side: Side;
}

export function createBotState(): BotState {
  return { look: 0, side: RIGHT };
}

export function resetBotState(state: BotState): void {
  state.look = 0;
  state.side = RIGHT;
}

/**
 * Which side a bot is asking for this step.
 *
 * Returns a side, always — a bot holds a side down the way a player resting a finger on
 * the glass does, and {@link stepWoodsman}'s cadence is what turns that into swings. It
 * has no way to swing sooner than a person because there is no such way.
 *
 * Both draws are taken on every look whether or not they are used, so the two seats' bots
 * consume the stream at the same rate and neither is nudged by the other's luck.
 */
export function botSide(
  match: Readonly<Match>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  fixedDeltaSeconds: number,
  rng: Rng,
): Side {
  state.look -= fixedDeltaSeconds;
  if (state.look > 0) return state.side;

  const profile = BOT_PROFILES[difficulty];
  const waver = rng.float();
  const slip = rng.float();
  state.look = profile.reaction + waver * profile.waver;

  const read = safeSide(match, seat);
  state.side = slip < profile.blunder ? (read === LEFT ? RIGHT : LEFT) : read;
  return state.side;
}
