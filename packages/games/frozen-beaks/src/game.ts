import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BIRD_RADIUS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CENTRE_Y,
  FISH_RADIUS,
  FLOE_FAR,
  FLOE_LEFT,
  FLOE_NEAR,
  FLOE_RIGHT,
  DUNK_SECONDS,
  HOLE_RADIUS,
  MATCH_SECONDS,
  MOVE_DEADZONE,
  SEATS,
  TARGET_FISH,
  TIERS,
  botCommand,
  createBotState,
  createCommand,
  createGame,
  floeOf,
  plantFeet,
  resetBotState,
  resetGame,
  seatAxisSign,
  step,
  tierFor,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Command, Fish, Game as Field, Hole, Tier } from './rules.js';

/**
 * Frozen Beaks — two ice floes, two birds, one race to thirty fish.
 *
 * `rules.ts` holds the whole simulation in logical units. This file does three things and
 * nothing else: it turns a key or a finger into the {@link Command} the rules read, it
 * gives each bot seat its own generator, and it draws. It never adds to the simulation —
 * a test renders forty frames at two different alphas and asserts nothing moved.
 *
 * The two floes are half-turn images of one another, so there is no per-seat placement to
 * undo when drawing: each player reads their own end as the near one and the picture is
 * unchanged by turning the device over. What does have to be mirrored is the **keyboard**
 * axis — the far player's left arrow is the device's right — and that happens in exactly
 * one place, {@link seatAxisSign}. A finger is not mirrored, because a finger names a
 * point on the glass and a point on the glass means the same point from either side.
 */

const COLOUR_WATER = '#0f3350';
const COLOUR_DEEP = '#08243c';
const COLOUR_ICE = '#e9f2fb';
const COLOUR_ICE_EDGE = '#c2d6ea';
const COLOUR_INK = '#1b2b3d';
const COLOUR_TRACK = 'rgba(27, 43, 61, 0.18)';
const COLOUR_FISH = '#8fa7bd';
const COLOUR_RIPPLE = 'rgba(233, 242, 251, 0.55)';

/**
 * How far the wind-up pips sit in front of a bird's head.
 *
 * In *front*, meaning toward the middle of the device rather than toward the player's own
 * shore. Either side reads the same, and this one is the side with room: a bird pressed
 * against its own shore would otherwise push its pips onto the tally bar, and a bird
 * pressed against the centre line would push them over the water. 34 units keeps every
 * pip inside that seat's own half of the board at both extremes of its floe.
 */
const PIP_LIFT = BIRD_RADIUS + 12;

export class FrozenBeaksGame implements Game {
  readonly #field: Field = createGame();
  readonly #command: Record<SeatId, Command> = { p1: createCommand(), p2: createCommand() };
  readonly #botState: Record<SeatId, BotState> = { p1: createBotState(), p2: createBotState() };

  /**
   * A generator per seat, plus one for the ice, all seeded from the one the shell handed
   * us.
   *
   * The layout is drawn once, before the match, and after that the simulation draws
   * nothing at all — two humans play a match with no randomness in it anywhere. Only the
   * bots draw, and they draw from separate streams because the *number* of decisions a
   * tier makes depends on its thinking interval: `hard` looks 2.1 times as often as
   * `easy`, so a shared stream would make one seat's play a function of which tier was
   * sitting opposite. Star Catcher measured that shape at 1.4 points of win rate.
   */
  #rng: Record<SeatId, Rng> = { p1: new Rng(1), p2: new Rng(2) };
  #difficulty: Record<SeatId, BotDifficulty | null> = { p1: null, p2: null };

  /** Read-only view for tests and the balance harness. Never mutate through it. */
  get field(): Readonly<Field> {
    return this.#field;
  }

  init(context: GameContext): void {
    const layout = new Rng(context.rng.next() | 0);
    this.#rng = { p1: new Rng(context.rng.next() | 0), p2: new Rng(context.rng.next() | 0) };
    this.#difficulty = { p1: context.botDifficulty('p1'), p2: context.botDifficulty('p2') };
    for (let i = 0; i < SEATS.length; i += 1) {
      const seat = SEATS[i] as SeatId;
      resetBotState(this.#botState[seat]);
      this.#command[seat].dirX = 0;
      this.#command[seat].dirY = 0;
    }
    resetGame(this.#field, layout);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#field.winner !== null) return;
    for (let i = 0; i < SEATS.length; i += 1) {
      this.#read(SEATS[i] as SeatId, input, fixedDeltaSeconds);
    }
    step(this.#field, fixedDeltaSeconds, this.#command.p1, this.#command.p2);
  }

  /**
   * One seat's intent for this step, as one of nine headings.
   *
   * Two spellings of one thing. A finger says **where** and the game takes the sign of
   * the gap on each axis; a key says **which way** and the game takes the sign of the
   * move vector on each axis. Both land on exactly the same nine values — eight compass
   * points and a standstill — and both walk at `WALK_SPEED`, so neither instrument can
   * name a heading the other cannot or reach it any sooner.
   *
   * Taking the *sign* rather than the position is what keeps this inside
   * `docs/input-parity.md`: the pointer never contributes a continuous quantity, so the
   * precision envelope is not even load-bearing here.
   */
  #read(seat: SeatId, input: InputState, dt: number): void {
    const command = this.#command[seat];
    const difficulty = this.#difficulty[seat];
    if (difficulty !== null) {
      botCommand(this.#field, seat, difficulty, this.#botState[seat], this.#rng[seat], dt, command);
      return;
    }

    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    let dx: number;
    let dy: number;
    if (pointer !== null) {
      // Absolute, and it can be: a horizontal split gives each seat a full-width band, so
      // every point on its own floe is directly under its own thumb
      // (`docs/input-idiom.md`, `rt-split`). Inside the deadzone the answer is a
      // standstill, which in this game is also the release.
      const bird = floeOf(this.#field, seat).bird;
      const gapX = pointer.x - bird.x;
      const gapY = pointer.y - bird.y;
      dx = Math.abs(gapX) <= MOVE_DEADZONE ? 0 : gapX > 0 ? 1 : -1;
      dy = Math.abs(gapY) <= MOVE_DEADZONE ? 0 : gapY > 0 ? 1 : -1;
    } else {
      const axis = seatAxisSign(seat);
      const moveX = seatInput.move.x * axis;
      const moveY = seatInput.move.y * axis;
      dx = moveX > 0 ? 1 : moveX < 0 ? -1 : 0;
      dy = moveY > 0 ? 1 : moveY < 0 ? -1 : 0;
    }
    // A diagonal is normalised through the one constant the bot's headings use, so the
    // two producers of a heading are bit-identical and eight ways round is eight equal
    // speeds rather than four fast ones.
    if (dx !== 0 && dy !== 0) {
      command.dirX = dx * Math.SQRT1_2;
      command.dirY = dy * Math.SQRT1_2;
    } else {
      command.dirX = dx;
      command.dirY = dy;
    }
  }

  /**
   * Pause and resume both plant every bird's feet.
   *
   * `InputManager.clear()` drops every key and pointer, which arrives as a standstill on
   * the first step back — and a standstill in this game is a release. Without this,
   * opening the pause menu mid-walk slides the bird on the way out of it. A test covers
   * both directions.
   */
  onPause(): void {
    plantFeet(this.#field, 'p1');
    plantFeet(this.#field, 'p2');
  }

  onResume(): void {
    plantFeet(this.#field, 'p1');
    plantFeet(this.#field, 'p2');
  }

  getScore(): MatchScore {
    return {
      p1: this.#field.p1.bird.caught,
      p2: this.#field.p2.bird.caught,
      winner: winnerOf(this.#field),
    };
  }

  destroy(): void {
    resetGame(this.#field, null);
    resetBotState(this.#botState.p1);
    resetBotState(this.#botState.p2);
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer, alpha = 0): void {
    renderer.clear(COLOUR_WATER);
    this.#drawClock(renderer);
    for (let i = 0; i < SEATS.length; i += 1) {
      const seat = SEATS[i] as SeatId;
      this.#drawFloe(renderer, seat);
      this.#drawFish(renderer, seat);
      this.#drawBird(renderer, seat, alpha);
      this.#drawTally(renderer, seat);
    }
  }

  /**
   * How much of the match is left, as a bar down the left edge that drains from both ends
   * toward the middle. One object, shared by both players and unchanged by the half-turn,
   * so neither of them is reading a clock the other cannot.
   */
  #drawClock(renderer: Renderer): void {
    const top = 40;
    const length = BOARD_HEIGHT - top * 2;
    const left = Math.max(0, Math.min(1, this.#field.clock / MATCH_SECONDS));
    renderer.rect(6, top, 6, length, COLOUR_DEEP);
    renderer.rect(6, CENTRE_Y - (length * left) / 2, 6, length * left, COLOUR_RIPPLE);
  }

  /**
   * One seat's ice, and the holes in it.
   *
   * The seat band along a player's own shore is the shape that tells the two floes apart
   * without colour: one stripe for the near seat, two for the far one. The holes are
   * drawn at exactly the radius the rule uses, so "don't cross the rim" is a thing a
   * player can see rather than a number in a spec.
   */
  #drawFloe(renderer: Renderer, seat: SeatId): void {
    const floe = floeOf(this.#field, seat);
    const palette = SEAT_PALETTE[seat];
    const top = seat === 'p1' ? FLOE_FAR : BOARD_HEIGHT - FLOE_NEAR;
    const height = FLOE_NEAR - FLOE_FAR;
    const width = FLOE_RIGHT - FLOE_LEFT;
    renderer.rect(FLOE_LEFT, top, width, height, COLOUR_ICE);
    renderer.strokeRect(FLOE_LEFT + 2, top + 2, width - 4, height - 4, 4, COLOUR_ICE_EDGE);

    const shore = seat === 'p1' ? FLOE_NEAR - 12 : top + 2;
    renderer.rect(FLOE_LEFT, shore, width, 10, palette.tint);
    if (seat === 'p2') renderer.rect(FLOE_LEFT, shore + 16, width, 10, palette.tint);

    for (let i = 0; i < floe.holes.length; i += 1) {
      const hole = floe.holes[i] as Hole;
      renderer.circle(hole.x, hole.y, HOLE_RADIUS, COLOUR_DEEP);
      renderer.strokeCircle(hole.x, hole.y, HOLE_RADIUS - 3, 5, COLOUR_ICE_EDGE);
    }
  }

  /** A fish is a body and a forked tail: a rect and two lines, never a disc like a hole. */
  #drawFish(renderer: Renderer, seat: SeatId): void {
    const floe = floeOf(this.#field, seat);
    for (let i = 0; i < floe.fish.length; i += 1) {
      const fish = floe.fish[i] as Fish;
      if (!fish.active) continue;
      renderer.rect(
        fish.x - FISH_RADIUS,
        fish.y - FISH_RADIUS / 2,
        FISH_RADIUS * 2,
        FISH_RADIUS,
        COLOUR_FISH,
      );
      renderer.line(
        fish.x + FISH_RADIUS,
        fish.y,
        fish.x + FISH_RADIUS + 7,
        fish.y - 7,
        3,
        COLOUR_FISH,
      );
      renderer.line(
        fish.x + FISH_RADIUS,
        fish.y,
        fish.x + FISH_RADIUS + 7,
        fish.y + 7,
        3,
        COLOUR_FISH,
      );
    }
  }

  /**
   * A bird, or the splash where one used to be.
   *
   * Rule 7: **the near seat is round and the far seat is square, everywhere in this
   * game** — the body, the splash it leaves when it goes in, and the milestone markers on
   * its tally. Two birds on one screen at once is the pair most likely to be confused,
   * and the two seat colours sit at 1.03:1 under deuteranopia
   * (`packages/engine/src/palette-vision.test.ts`), so the shape is not decoration.
   */
  #drawBird(renderer: Renderer, seat: SeatId, alpha: number): void {
    const bird = floeOf(this.#field, seat).bird;
    const palette = SEAT_PALETTE[seat];

    if (bird.phase === 'dunk') {
      const swell = HOLE_RADIUS - 10 + (1 - bird.dunk / DUNK_SECONDS) * 8;
      if (seat === 'p1') {
        renderer.strokeCircle(bird.dunkX, bird.dunkY, swell, 5, palette.base);
      } else {
        renderer.strokeRect(
          bird.dunkX - swell,
          bird.dunkY - swell,
          swell * 2,
          swell * 2,
          5,
          palette.base,
        );
      }
      return;
    }

    const x = bird.prevX + (bird.x - bird.prevX) * alpha;
    const y = bird.prevY + (bird.y - bird.prevY) * alpha;
    const sign = seatAxisSign(seat);

    if (bird.flash > 0) {
      renderer.strokeCircle(x, y, BIRD_RADIUS + 4 + bird.flash * 8, 3, COLOUR_TRACK);
    }

    if (seat === 'p1') {
      renderer.circle(x, y, BIRD_RADIUS, palette.base);
      renderer.strokeCircle(x, y, BIRD_RADIUS - 3, 3, COLOUR_INK);
    } else {
      renderer.rect(
        x - BIRD_RADIUS,
        y - BIRD_RADIUS,
        BIRD_RADIUS * 2,
        BIRD_RADIUS * 2,
        palette.base,
      );
      renderer.strokeRect(
        x - BIRD_RADIUS + 3,
        y - BIRD_RADIUS + 3,
        BIRD_RADIUS * 2 - 6,
        BIRD_RADIUS * 2 - 6,
        3,
        COLOUR_INK,
      );
    }

    // The beak points the way the bird is heading, or up its own floe when it is still,
    // so which way a slide would leave is readable before it leaves.
    const headX = bird.phase === 'slide' ? bird.slideX : bird.lastDirX;
    const headY = bird.phase === 'slide' ? bird.slideY : bird.lastDirY;
    const bx = headX === 0 && headY === 0 ? 0 : headX;
    const by = headX === 0 && headY === 0 ? -sign : headY;
    renderer.line(
      x + bx * (BIRD_RADIUS - 6),
      y + by * (BIRD_RADIUS - 6),
      x + bx * (BIRD_RADIUS + 9),
      y + by * (BIRD_RADIUS + 9),
      5,
      COLOUR_INK,
    );

    this.#drawWindUp(renderer, seat, x, y, sign);
  }

  /**
   * Three pips over a bird's head, filled to the slide it has packed, with a bar for the
   * progress to the next one.
   *
   * Both players can read both birds' pips, so committing to a long slide is visible to
   * the person about to watch it happen — and it is the only thing the bot reads about
   * its own wind-up, which is rule 6 in a picture.
   */
  #drawWindUp(renderer: Renderer, seat: SeatId, x: number, y: number, sign: number): void {
    const bird = floeOf(this.#field, seat).bird;
    const tier = tierFor(bird.charge);
    const pipY = y - sign * PIP_LIFT;
    for (let i = 0; i < TIERS.length; i += 1) {
      const pipX = x - 16 + i * 16;
      if (i <= tier) renderer.circle(pipX, pipY, 5, COLOUR_INK);
      else renderer.strokeCircle(pipX, pipY, 5, 2, COLOUR_TRACK);
    }
    // How far along to the next tier, as a ring closing around the bird — a length rather
    // than a bar, so it stays inside the bird's own reach wherever on the floe it stands.
    if (tier < TIERS.length - 1 && bird.phase === 'walk') {
      const from = tier < 0 ? 0 : (TIERS[tier] as Tier).windUp;
      const to = (TIERS[tier + 1] as Tier).windUp;
      const along = Math.max(0, Math.min(1, (bird.charge - from) / (to - from)));
      renderer.strokeCircle(x, y, BIRD_RADIUS + 11 - along * 8, 2, COLOUR_TRACK);
    }
  }

  /**
   * The race, as a bar along the player's own shore with three milestone markers.
   *
   * The markers are the seat's own shape and there are always exactly three of them, so
   * they read as a pattern rather than as a score — the fill is the score, and it is a
   * length rather than a number because this game draws no text at all.
   */
  #drawTally(renderer: Renderer, seat: SeatId): void {
    const bird = floeOf(this.#field, seat).bird;
    const palette = SEAT_PALETTE[seat];
    const y = seat === 'p1' ? BOARD_HEIGHT - 12 : 6;
    const width = BOARD_WIDTH - 80;
    const along = Math.max(0, Math.min(1, bird.caught / TARGET_FISH));
    renderer.rect(40, y, width, 6, COLOUR_DEEP);
    renderer.rect(40, y, width * along, 6, palette.soft);
    for (let i = 1; i <= 3; i += 1) {
      const markX = 40 + (width * i) / 3;
      if (seat === 'p1') renderer.circle(markX, y + 3, 6, palette.base);
      else renderer.rect(markX - 6, y - 3, 12, 12, palette.base);
    }
  }
}
