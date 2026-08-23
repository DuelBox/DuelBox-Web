import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Spike Attacks, as pure rules.
 *
 * A row of standing stones each, and a volley of spikes that comes down the row from one
 * end or the other. A stone walls off the end it leans against and shelters the pocket of
 * ground behind it; be in that pocket when the volley lands and the stone takes the blow
 * for you, and cracks. Be anywhere else and it is you the spikes reach. The stones are
 * finite, the volleys are not, so the round is over before anybody decides it is.
 *
 * Four decisions shape everything below, and each is argued where it lives:
 *
 *  - **A stone shelters one end of the row, not both** ({@link shelterAt}). That single
 *    asymmetry is what turns "stand behind a rock" into a decision: there is no position
 *    that is safe from everything, only positions that are safe from what is announced,
 *    and — where two stones lean opposite ways within a pocket of each other — *nooks*
 *    that are safe from either. Finding the next nook is the game.
 *  - **Sheltering costs the stone** ({@link takeCover}). Cover is a consumable, so the
 *    nook you are standing in is the one you are destroying, and standing still is a
 *    strategy with a fuse on it.
 *  - **Every seat's stones are its own** ({@link dealRound}). Both fields are dealt from
 *    one draw of the seeded stream, so they are identical stone for stone rather than
 *    similar on average — and they are separate objects, so the crack you put in yours is
 *    yours alone.
 *  - **Walking is a level, never an event** ({@link driveField}). There is no press to
 *    repeat and nothing a faster instrument can do more of, which is what keeps a thumb
 *    and a keyboard worth the same here.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit along one seat's own
 * row, and every duration is in simulated seconds.
 */

/**
 * The end of the row a volley comes from, and the end a stone leans against.
 *
 * Signed so that the arithmetic in {@link shelterAt} is one expression rather than two
 * branches: a stone shielding {@link LEFT} keeps its pocket at increasing x, one shielding
 * {@link RIGHT} at decreasing x, and the sign is the difference.
 */
export const LEFT = -1;
export const RIGHT = 1;
export type Side = typeof LEFT | typeof RIGHT;

/**
 * Both ends at once. Only a nook survives one, which is why it is the thing that ends a
 * round rather than merely another volley.
 */
export const PINCER = 0;
export type Bearing = Side | typeof PINCER;

/** Stones in a row. Odd, so the starting position has the same reach either way. */
export const SLOTS = 9;
/** Units between neighbouring stones. */
export const SPACING = 58;
/** The row runs from the first stone to the last; there is nowhere to stand beyond them. */
export const ROW_LENGTH = (SLOTS - 1) * SPACING;
/** Both players start in the middle of their own row. */
export const START_X = ROW_LENGTH / 2;

/**
 * How far behind a stone its shelter reaches.
 *
 * Deliberately a little **more** than {@link SPACING}: a stone covers its own ground and
 * its neighbour's, and no further. That one relation is what makes a nook possible at all
 * — a stone leaning left and a stone leaning right, one or two slots apart, overlap their
 * pockets and leave ground that is safe from either end. Set it below the spacing and no
 * two stones would ever overlap, so a {@link PINCER} would be unsurvivable from the first
 * volley; set it above two spacings and every stone would reach its second neighbour,
 * nooks would be everywhere and there would be nothing to walk towards.
 */
export const POCKET = 66;

/** Units a second a player walks. The same number for a person and for a bot (rule 6). */
export const WALK_SPEED = 190;

/**
 * The player's half-width, and the stone's.
 *
 * Nothing in the simulation collides — a player passes freely between the stones, which is
 * what standing among boulders is like. They live here so that the drawing and the rules
 * cannot drift about how big anything is.
 *
 * The stone's half-width is not only a drawing: a player standing *against* a stone is
 * behind it, so its shelter starts one half-width in front of it rather than exactly at
 * its centre. Without that, the safest-looking place on the board — right at the stone —
 * would be a knife-edge with the killing side of it three units away, and the first
 * measured set of bots proved it: `hard` walked to the stone it liked best, wobbled two
 * units past the centre, and died there. Cover you can stand against is cover; a boundary
 * a body straddles is a trap.
 */
export const BODY_RADIUS = 16;
export const STONE_HALF_WIDTH = 15;

/** Blows a stone takes before it is rubble. */
export const STONE_HITS = 2;

/** All the cover a seat has for the whole round. The termination argument rests on it. */
export const FIELD_DURABILITY = SLOTS * STONE_HITS;

/**
 * Blows a player can take before they are out of the round.
 *
 * Two rather than one, and the second one is not softness. Both rows are dealt the same
 * stones and receive the same volleys, and a survived volley costs the same durability on
 * both, so **two players who never miss run out of cover on the identical volley** — the
 * shared clock this game has to be dragged off. A hit costs a life and *no* durability, so
 * the moment one seat is caught the two fields stop being the same field: the seat that was
 * hit still holds cover the other has spent.
 *
 * Measured, `hard` against `hard`: one life drew **69%** of rounds and gave `hard` 79% of
 * decided matches against `normal`; two lives draw **61%** and give `hard` 88%. It is worth
 * the extra field, and it is honest about what it is besides — a mistake in the first
 * second of a round should not be the whole round.
 */
export const LIVES = 2;

/**
 * The volley now in flight is announced the moment the last one lands, so the whole
 * interval is its warning. This is not a reaction game: the direction is never a surprise
 * and both players read it at the same instant. What is scarce is the *time* it leaves.
 */
export const FIRST_WARN = 1.6;
/** Multiplied into the warning after every volley. */
export const WARN_DECAY = 0.8;
/**
 * The floor the warning falls to.
 *
 * At {@link WALK_SPEED} it buys 80 units — a little under a stone and a half — so late in
 * a round a player must already be standing next to the cover they are going to need. That
 * is the whole difficulty curve: nothing becomes impossible, everything becomes near.
 */
export const MIN_WARN = 0.3;

/** The first volleys come from one end only, so a round opens with somewhere to go. */
export const PINCER_FROM = 4;
/** Added to the chance of a pincer per volley after that, up to the ceiling. */
export const PINCER_RAMP = 0.08;
export const PINCER_MAX = 0.6;

/**
 * Volleys a round can possibly contain.
 *
 * **This is the termination argument, and it is arithmetic rather than a clock.** Every
 * volley costs a seat one of exactly two finite things: a point of durability if it took
 * cover — one for a single bearing, two for a pincer — or a life if it did not. The field
 * holds {@link FIELD_DURABILITY} points and the player {@link LIVES} lives, neither of
 * which is ever replaced, and the round ends on the volley that takes a seat's last life.
 * So no round can reach a volley past this index, whatever either player does and however
 * well they do it.
 *
 * The density ramp above shortens a round a great deal in practice; it is not what
 * guarantees it ends. A test drives a player who can be anywhere at any instant — better
 * than any player could possibly be — and still finds the round over inside this many
 * volleys.
 */
export const MAX_VOLLEYS = FIELD_DURABILITY + LIVES;

/** Seconds the result of a round is held before the next one is dealt. */
export const SETTLE_SECONDS = 1;

/** Rounds a seat must win to take the match. */
export const TARGET_ROUNDS = 3;
/** Hard cap, so a match of drawn rounds still ends. */
export const MAX_ROUNDS = 9;

/** One stone: where it stands, which end it leans against, and how much of it is left. */
export interface Stone {
  /** Fixed by the slot. The row is evenly spaced so that no seat can be dealt a nearer set. */
  readonly x: number;
  shields: Side;
  /** Blows it can still take. Zero is rubble, which shelters nothing. */
  hits: number;
}

/** One seat's ground: its own stones, its own position on the row, and how much is left of it. */
export interface Field {
  readonly stones: Stone[];
  x: number;
  /** Blows this player can still take. Zero is out of the round. */
  lives: number;
  /** Volleys this seat has taken cover from. The number a spectator would count. */
  survived: number;
}

/** Whether a seat is still in the round. */
export function isUp(field: Readonly<Field>): boolean {
  return field.lives > 0;
}

export type Phase = 'live' | 'settling' | 'over';

export interface Game {
  readonly p1: Field;
  readonly p2: Field;
  /**
   * The bearing of every volley of the round, dealt before either player moves.
   *
   * Dealt up front rather than rolled as it goes, and that is worth more than it looks: it
   * means the world is drawn from the seeded stream at a *fixed* point, before any bot has
   * spent a value, so the same seed deals the same volleys whether the seats hold two
   * people, two bots, or one of each. A schedule rolled per volley would be a different
   * schedule depending on who was playing.
   */
  readonly schedule: Int8Array;
  /** Index of the volley now in flight. */
  volley: number;
  /** Seconds until it lands. */
  timer: number;
  /** The whole flight time of the volley now in flight, so a renderer can show progress. */
  warn: number;
  phase: Phase;
  /** Counts down the settle between rounds. */
  hold: number;
  p1Rounds: number;
  p2Rounds: number;
  rounds: number;
  /** Who took the last round, or 'draw'. Null before the first is decided. */
  lastRound: SeatId | 'draw' | null;
  winner: SeatId | 'draw' | null;
}

/** Where the stone in a slot stands, along one seat's own row. */
export function slotX(slot: number): number {
  return slot * SPACING;
}

function makeField(): Field {
  const stones: Stone[] = [];
  for (let i = 0; i < SLOTS; i += 1) stones.push({ x: slotX(i), shields: LEFT, hits: STONE_HITS });
  return { stones, x: START_X, lives: LIVES, survived: 0 };
}

export function createGame(): Game {
  return {
    p1: makeField(),
    p2: makeField(),
    schedule: new Int8Array(MAX_VOLLEYS),
    volley: 0,
    timer: FIRST_WARN,
    warn: FIRST_WARN,
    phase: 'live',
    hold: 0,
    p1Rounds: 0,
    p2Rounds: 0,
    rounds: 0,
    lastRound: null,
    winner: null,
  };
}

export function fieldOf(game: Readonly<Game>, seat: SeatId): Field {
  return seat === 'p1' ? game.p1 : game.p2;
}

export function roundsOf(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Rounds : game.p2Rounds;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** How long the volley at `index` is in flight. Shorter every volley, down to the floor. */
export function warnAt(index: number): number {
  const warn = FIRST_WARN * Math.pow(WARN_DECAY, index);
  return warn < MIN_WARN ? MIN_WARN : warn;
}

/** How likely the volley at `index` comes from both ends at once. */
export function pincerChanceAt(index: number): number {
  const chance = (index - PINCER_FROM) * PINCER_RAMP;
  if (chance <= 0) return 0;
  return chance > PINCER_MAX ? PINCER_MAX : chance;
}

/**
 * The bearing one draw produces at a given point of the round.
 *
 * Whatever the pincer chance is, the rest of the interval splits exactly in half — so
 * neither end of the row is ever the likelier one, at any density, and a player who has
 * learned to favour one side has learned nothing.
 */
function bearingFrom(index: number, roll: number): Bearing {
  const pincer = pincerChanceAt(index);
  if (roll < pincer) return PINCER;
  return roll < pincer + (1 - pincer) / 2 ? LEFT : RIGHT;
}

/**
 * Values dealt at the start of every round. Always exactly this many, whatever comes out.
 *
 * One picks the guaranteed nook, one settles each stone's lean, one settles each volley's
 * bearing. Constant so that a round's shape cannot depend on how the last one was played.
 */
export const ROUND_DRAWS = 1 + SLOTS + MAX_VOLLEYS;

/**
 * Deal a fresh field and a fresh schedule to both seats.
 *
 * **One deal, copied, rather than two deals.** Two fields drawn independently from the
 * same generator would be fair on average and a round is played once: a seat dealt three
 * nooks in a row against a seat dealt none has lost to the stream rather than to the other
 * player. Dealing once and copying deletes the question — the two rows are not similar in
 * difficulty, they are the same stones leaning the same ways in the same order.
 *
 * They are nonetheless **separate objects**, and that is the other half of the design: a
 * stone is spent by the player who hides behind it, so a shared array would mean one
 * seat's shelter crumbled under the other seat's blows. Equal in value, independent in
 * identity — `rules.test.ts` asserts both, because with two objects neither is free.
 *
 * The schedule is single: a volley is an event in the world rather than a possession, and
 * both rows receive the same one from the same end at the same instant.
 */
export function dealRound(game: Game, rng: Rng): void {
  // One draw, spent before the leans, so the nook is not correlated with any of them.
  const anchor = Math.floor(rng.float() * (SLOTS - 1));

  for (let i = 0; i < SLOTS; i += 1) {
    const lean: Side = rng.float() < 0.5 ? LEFT : RIGHT;
    const stone = game.p1.stones[i] as Stone;
    stone.shields = lean;
    stone.hits = STONE_HITS;
  }

  /*
   * One adjacent pair is forced to lean apart, which guarantees the row opens with at
   * least one nook — and so with at least one stone of each lean.
   *
   * Without it, one row in every 256 leans entirely one way, and the first volley from the
   * other end kills both players before either has taken a step. That is a round nobody
   * played, and a fair one is no defence: both seats being equally robbed is still a
   * wasted round.
   */
  (game.p1.stones[anchor] as Stone).shields = LEFT;
  (game.p1.stones[anchor + 1] as Stone).shields = RIGHT;

  for (let i = 0; i < SLOTS; i += 1) {
    const from = game.p1.stones[i] as Stone;
    const to = game.p2.stones[i] as Stone;
    to.shields = from.shields;
    to.hits = from.hits;
  }

  for (let i = 0; i < MAX_VOLLEYS; i += 1) game.schedule[i] = bearingFrom(i, rng.float());
}

function resetField(field: Field): void {
  field.x = START_X;
  field.lives = LIVES;
  field.survived = 0;
}

/** Start a fresh round on a freshly dealt field. The only place the schedule is written. */
export function startRound(game: Game, rng: Rng): void {
  resetField(game.p1);
  resetField(game.p2);
  dealRound(game, rng);
  game.volley = 0;
  game.timer = warnAt(0);
  game.warn = game.timer;
  game.phase = 'live';
  game.hold = 0;
  game.rounds += 1;
}

/** Start a fresh match. */
export function resetGame(game: Game, rng: Rng): void {
  game.p1Rounds = 0;
  game.p2Rounds = 0;
  game.rounds = 0;
  game.lastRound = null;
  game.winner = null;
  startRound(game, rng);
}

/**
 * Put the match back to nothing without touching the generator.
 *
 * Tearing a match down is not the same as starting one: `destroy` must leave nothing
 * behind, and dealing a round on the way out would spend draws from the host's stream
 * after the match they belong to has ended.
 */
export function clearGame(game: Game): void {
  resetField(game.p1);
  resetField(game.p2);
  game.p1Rounds = 0;
  game.p2Rounds = 0;
  game.rounds = 0;
  game.volley = 0;
  game.timer = FIRST_WARN;
  game.warn = FIRST_WARN;
  game.phase = 'live';
  game.hold = 0;
  game.lastRound = null;
  game.winner = null;
  game.schedule.fill(LEFT);
  for (let i = 0; i < SLOTS; i += 1) {
    (game.p1.stones[i] as Stone).hits = STONE_HITS;
    (game.p2.stones[i] as Stone).hits = STONE_HITS;
  }
}

/** The bearing of the volley now in flight. */
export function bearingOf(game: Readonly<Game>): Bearing {
  // The schedule holds one entry per volley a round can contain and a round ends on the
  // volley that empties the field, so `volley` is always inside it. See MAX_VOLLEYS.
  return (game.schedule[game.volley] ?? PINCER) as Bearing;
}

/**
 * The standing stone sheltering `x` from `side`, or −1 for open ground.
 *
 * A stone leaning against the left keeps its pocket at increasing x and a stone leaning
 * against the right at decreasing x, so the gap is measured *with* the sign of the side
 * and a negative gap means the player is on the wrong side of it — in front of the wall,
 * where the spikes are.
 *
 * The nearest qualifying stone is the one returned, and so the one that takes the blow.
 * That is physical — it is the stone you are actually behind — and it is a lever: a player
 * standing between two stones that both shelter them chooses which one they spend by
 * standing nearer it.
 */
export function shelterAt(field: Readonly<Field>, x: number, side: Side): number {
  let best = -1;
  let bestGap = Infinity;
  const stones = field.stones;
  for (let i = 0; i < stones.length; i += 1) {
    const stone = stones[i] as Stone;
    if (stone.hits <= 0 || stone.shields !== side) continue;
    const gap = (x - stone.x) * -side;
    if (gap < -STONE_HALF_WIDTH || gap > POCKET) continue;
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return best;
}

/** Whether `x` is sheltered from a volley on this bearing, ignoring what it would cost. */
export function coveredAt(field: Readonly<Field>, x: number, from: Bearing): boolean {
  if (from !== RIGHT && shelterAt(field, x, LEFT) < 0) return false;
  if (from !== LEFT && shelterAt(field, x, RIGHT) < 0) return false;
  return true;
}

/**
 * Resolve one volley against one seat's ground.
 *
 * Cover is worked out for both ends before anything is spent, so a player caught by a
 * pincer they were half-ready for does not lose the stone that did hold — there is nothing
 * left to hold it for.
 */
function takeCover(field: Field, from: Bearing): boolean {
  const left = from === RIGHT ? -1 : shelterAt(field, field.x, LEFT);
  const right = from === LEFT ? -1 : shelterAt(field, field.x, RIGHT);
  if (from !== RIGHT && left < 0) return false;
  if (from !== LEFT && right < 0) return false;
  if (left >= 0) (field.stones[left] as Stone).hits -= 1;
  if (right >= 0) (field.stones[right] as Stone).hits -= 1;
  return true;
}

/** What one seat is asking of its legs this step: left, nothing, or right. */
export type Ask = typeof LEFT | 0 | typeof RIGHT;

/**
 * Walk a seat's player.
 *
 * **The ask is a level and never an event.** There is no press to repeat, no cadence to
 * beat and nothing at all that happens faster if it is asked for more often, so a mashed
 * key, a held key and a thumb resting on the glass move a player at exactly the same
 * speed. That is what keeps this game fair across input families without declaring
 * `sameInputClassOnly` — a rate cannot be won when there is no rate.
 *
 * The magnitude is thrown away and only the sign is kept, so a pointer cannot ask for a
 * fraction of a step and a keyboard cannot ask for a whole one.
 */
export function driveField(field: Field, ask: Ask, fixedDeltaSeconds: number): void {
  if (field.lives <= 0 || ask === 0) return;
  const moved = field.x + ask * WALK_SPEED * fixedDeltaSeconds;
  field.x = moved < 0 ? 0 : moved > ROW_LENGTH ? ROW_LENGTH : moved;
}

export interface StepResult {
  /** True on the step a volley landed. */
  readonly landed: boolean;
  /** Seats it hit. Both can be, which is a drawn round. */
  readonly hit: readonly SeatId[];
  /** True on the step a round was decided. */
  readonly roundOver: boolean;
}

const hitScratch: SeatId[] = [];
const result: { landed: boolean; hit: SeatId[]; roundOver: boolean } = {
  landed: false,
  hit: hitScratch,
  roundOver: false,
};
const SEATS: readonly SeatId[] = ['p1', 'p2'];

/**
 * One fixed step.
 *
 * Both players are walked before the volley is resolved and both are resolved against the
 * same landing, so a volley that catches both is the drawn round it actually is rather
 * than a win for whichever seat the loop happened to read first.
 */
export function step(
  game: Game,
  fixedDeltaSeconds: number,
  p1Ask: Ask,
  p2Ask: Ask,
  rng: Rng,
): StepResult {
  hitScratch.length = 0;
  result.landed = false;
  result.roundOver = false;
  if (game.phase === 'over') return result;

  if (game.phase === 'settling') {
    game.hold -= fixedDeltaSeconds;
    if (game.hold <= 0) {
      if (decided(game)) finish(game);
      else startRound(game, rng);
    }
    return result;
  }

  driveField(game.p1, p1Ask, fixedDeltaSeconds);
  driveField(game.p2, p2Ask, fixedDeltaSeconds);

  game.timer -= fixedDeltaSeconds;
  if (game.timer > 0) return result;

  // Both seats are resolved against the same landing before either loss is applied, so a
  // volley that catches both catches both.
  const from = bearingOf(game);
  for (const seat of SEATS) {
    const field = fieldOf(game, seat);
    if (takeCover(field, from)) field.survived += 1;
    else hitScratch.push(seat);
  }
  for (const seat of hitScratch) fieldOf(game, seat).lives -= 1;

  result.landed = true;
  game.volley += 1;
  game.warn = warnAt(game.volley);
  game.timer = game.warn;

  if (!isUp(game.p1) || !isUp(game.p2)) {
    endRound(game);
    result.roundOver = true;
  }
  return result;
}

function endRound(game: Game): void {
  const winner = isUp(game.p1) ? 'p1' : isUp(game.p2) ? 'p2' : 'draw';
  game.lastRound = winner;
  if (winner === 'p1') game.p1Rounds += 1;
  else if (winner === 'p2') game.p2Rounds += 1;
  game.phase = 'settling';
  game.hold = SETTLE_SECONDS;
}

function decided(game: Readonly<Game>): boolean {
  return (
    game.p1Rounds >= TARGET_ROUNDS || game.p2Rounds >= TARGET_ROUNDS || game.rounds >= MAX_ROUNDS
  );
}

function finish(game: Game): void {
  game.phase = 'over';
  game.winner =
    game.p1Rounds === game.p2Rounds ? 'draw' : game.p1Rounds > game.p2Rounds ? 'p1' : 'p2';
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Seconds between looks at the row. Between them it walks towards what it last chose. */
  readonly reaction: number;
  /** Magnitude of the random extra on that delay, so it is never metronomic. */
  readonly wander: number;
  /**
   * How much it weighs what comes *after* this volley — a pocket that is also a nook, and
   * a stone with life left in it. Zero is a player who only looks at the volley in flight.
   */
  readonly foresight: number;
}

/**
 * Three tiers, ordered by accuracy and reach and by nothing else.
 *
 * No tier walks faster, sees a stone a lower tier cannot, or learns a volley before it is
 * announced. What separates them is how often they look, how metronomic that is, and how
 * far past the volley in flight they think. The reach the volley leaves falls to about one
 * stone, and the interval to 0.30 s, so a tier that looks every 0.20 s and may wander to
 * 0.38 s misses whole volleys late in a round where `hard` cannot: at 0.07 s against 0.15 s
 * the two were within 71–29 of each other, and at 0.05 against 0.20 it is 88–12.
 *
 * **None of them is braver than another**, and that is deliberate. Slot Cars ordered its
 * tiers by how near the limit each was willing to run and its `hard` lost, because the
 * penalty for one misjudgement outweighed everything the boldness bought. Here the
 * equivalent knob is {@link BOT_MARGIN} — how much of the remaining flight a bot will
 * spend walking — and every tier shares it. A tier is better only by being righter.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.32, wander: 0.3, foresight: 0 },
  normal: { reaction: 0.2, wander: 0.18, foresight: 0.7 },
  hard: { reaction: 0.05, wander: 0.05, foresight: 1.5 },
});

/**
 * The fraction of the remaining flight a bot will commit to walking.
 *
 * Shared by every tier — see the note on {@link BOT_PROFILES}. Below one because a bot
 * decides at most once every `reaction` seconds and cannot correct in between, exactly as
 * a person who has already started running cannot.
 */
export const BOT_MARGIN = 0.88;

/** Units either side of its target the bot calls "there" and stops. Below one step's walk. */
export const BOT_ARRIVED = 3;

export interface BotState {
  /** Seconds until it looks at the row again. */
  cooldown: number;
  /** The place on the row it settled on, and walks towards until the next look. */
  target: number;
}

/**
 * How far either side of the cover it chose a bot is willing to stand.
 *
 * Shared by every tier, because this is not a skill: two people never stand in exactly the
 * same spot behind the same rock. It is checked against the shelter before it is taken, so
 * it never moves a bot out of the pocket it just decided to be in.
 */
export const BOT_STANCE = 40;

/**
 * How arbitrary a bot's choice between two stones that would both do is.
 *
 * Shared by every tier for the same reason as {@link BOT_STANCE}, and deliberately **too
 * small to change a bot's mind about anything that matters**: sheltered is worth
 * {@link SCORE_SHELTERED} and reachable {@link SCORE_REACHABLE}, so no amount of taste
 * within this range will send a bot to a stone that will not hold or that it cannot get
 * to. All it does is reorder the stones that would each have done — which is exactly the
 * decision that is arbitrary for a person, and exactly the one that has to differ between
 * two seats if the mirror is ever to break. Which stone you spend today is which stone you
 * do not have tomorrow, so a scrambled choice compounds into two different fields.
 */
export const BOT_TASTE = 150;

/** The golden ratio's fractional part: successive additions land far apart, and never repeat. */
const GOLDEN = 0.618033988749895;

export function createBotState(): BotState {
  return { cooldown: 0, target: START_X };
}

export function resetBotState(state: BotState): void {
  state.cooldown = 0;
  state.target = START_X;
}

/**
 * Values a bot draws from the shared stream per look. Always exactly this many, and drawn
 * before anything branches on any of them.
 *
 * The two bots share the game's single `Rng`, so a seat whose draw count depended on what
 * it decided would shift the other seat's stream — a seat bias made of arithmetic, of
 * exactly the kind Fruit Duel was caught by, where `normal` against `normal` came out 30–10
 * in a game with no seat asymmetry anywhere in its rules.
 *
 * Three, and each has a separate job, because **this game is its own mirror and that is a
 * problem before it is a virtue**. Both seats are dealt the same stones, receive the same
 * volleys and start on the same spot; two bots of one tier with nothing random in them are
 * the same pure function of the same state, so they choose the same cover, spend the same
 * stone and die to the same volley, for ever. Measured with all three pinned to zero:
 * every equal-tier pairing drew **every one of 900 rounds and every one of 100 matches**,
 * at all three tiers. The three draws are the smallest honest things that separate two
 * people of equal ability:
 *
 *  - **when they look** — the reaction interval wanders by up to `wander`;
 *  - **what they think of it** — every candidate's score is nudged by up to half of
 *    {@link BOT_TASTE}, which reorders the stones that would each have done and never
 *    reaches far enough to reorder anything else;
 *  - **where they stand** — the spot inside the chosen pocket varies by {@link BOT_STANCE},
 *    and standing a little to one side is what changes which stone takes the next blow.
 *
 * The third is the one that compounds: a different stone spent is a different field, and
 * from there the two rounds are no longer the same round.
 */
export const BOT_DRAWS_PER_LOOK = 3;

/**
 * What a bot is weighing, in one currency.
 *
 * The first two dominate everything else, because everything else is a preference and
 * those two are survival. **The third is what the first set of tiers got wrong.** A step
 * across open ground is the only way to die here, so the cost of walking has to outweigh
 * every preference for walking somewhere nicer — a unit a unit puts the whole row at 464,
 * which is more than any bonus below can offer. With the cost set faint, `hard`'s taste
 * for fresh stone had it hopping between pockets it was already safe in and it lost to
 * `easy`, which has no taste at all and stays put. See SPEC.md.
 */
const SCORE_SHELTERED = 1000;
const SCORE_REACHABLE = 500;
const SCORE_NOOK = 40;
const SCORE_PER_HIT = 8;
const SCORE_PER_UNIT = 1;

/**
 * What a bot thinks of standing at `x`, given the volley in flight.
 *
 * Everything it reads is on the screen: which stones still stand, which way they lean, how
 * cracked they are, where it is, which end the spikes are coming from and how long it has.
 * Nothing here consults the next volley's bearing, and `rules.test.ts` proves that the only
 * way it can be proved — by rewriting the rest of the schedule and finding the bot
 * unmoved.
 */
function scoreOf(
  field: Readonly<Field>,
  x: number,
  from: Bearing,
  profile: BotProfile,
  budget: number,
  jitter: number,
): number {
  const left = shelterAt(field, x, LEFT);
  const right = shelterAt(field, x, RIGHT);
  const sheltered = (from === RIGHT || left >= 0) && (from === LEFT || right >= 0);
  const travel = Math.abs(x - field.x);

  let score = -travel * SCORE_PER_UNIT + jitter * BOT_TASTE;
  if (sheltered) score += SCORE_SHELTERED;
  if (travel <= budget) score += SCORE_REACHABLE;
  if (profile.foresight <= 0) return score;

  // What the place is worth next time: a nook answers either end, and a stone with life in
  // it will still be there. A tier with no foresight is blind to both and burns its cover.
  if (left >= 0 && right >= 0) score += profile.foresight * SCORE_NOOK;
  let hits = 0;
  if (left >= 0) hits += (field.stones[left] as Stone).hits;
  if (right >= 0) hits += (field.stones[right] as Stone).hits;
  return score + profile.foresight * SCORE_PER_HIT * hits;
}

/**
 * The place on the row a bot walks towards.
 *
 * The candidates are the stones' own positions and the ground it is already standing on.
 * The stones are not a shortcut: a pocket runs from a stone to {@link POCKET} behind it and
 * two pockets overlap only across ground a stone stands on, so every position sheltered
 * from both ends is a position some stone occupies. Its own position is there because
 * *staying* has to be on the list of things it can decide to do — the alternative is a bot
 * that reconsiders sixty times a second and is therefore always in transit.
 */
function chooseCover(
  game: Readonly<Game>,
  field: Readonly<Field>,
  profile: BotProfile,
  bias: number,
  spot: number,
): number {
  const from = bearingOf(game);
  const budget = game.timer * WALK_SPEED * BOT_MARGIN;

  let phase = bias;
  let bestScore = -Infinity;
  let best = field.x;
  for (let i = 0; i <= SLOTS; i += 1) {
    phase += GOLDEN;
    if (phase >= 1) phase -= 1;
    const x = i === SLOTS ? field.x : slotX(i);
    const score = scoreOf(field, x, from, profile, budget, phase - 0.5);
    if (score > bestScore) {
      bestScore = score;
      best = x;
    }
  }

  // Where in the pocket to stand. Taken only if it is still cover — a stance that stepped
  // out of the shelter the bot just chose would be worse than no variation at all.
  const shifted = best + (spot - 0.5) * BOT_STANCE;
  if (shifted < 0 || shifted > ROW_LENGTH) return best;
  return coveredAt(field, shifted, from) ? shifted : best;
}

/**
 * Which way a bot is walking this step.
 *
 * It holds its chosen place between looks, so a slow tier is one that commits late and is
 * still crossing open ground when the spikes arrive — which is exactly what being slow
 * costs a person here.
 */
export function botAsk(
  game: Readonly<Game>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  fixedDeltaSeconds: number,
  rng: Rng,
): Ask {
  const field = fieldOf(game, seat);
  state.cooldown -= fixedDeltaSeconds;
  if (state.cooldown <= 0) {
    // All three drawn before anything branches on any of them. See BOT_DRAWS_PER_LOOK.
    const wander = rng.float();
    const bias = rng.float();
    const spot = rng.float();
    const profile = BOT_PROFILES[difficulty];
    state.cooldown = profile.reaction + wander * profile.wander;
    state.target = chooseCover(game, field, profile, bias, spot);
  }

  const gap = state.target - field.x;
  if (gap > BOT_ARRIVED) return RIGHT;
  if (gap < -BOT_ARRIVED) return LEFT;
  return 0;
}
