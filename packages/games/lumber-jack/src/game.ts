import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  CLEAR,
  LEFT,
  RIGHT,
  STUN_SECONDS,
  TARGET_LOGS,
  VISIBLE_SEGMENTS,
  YARD_HEIGHT,
  YARD_WIDTH,
  botSide,
  clearMatch,
  createBotState,
  createMatch,
  resetBotState,
  resetMatch,
  segmentAt,
  stepMatch,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Lean, Match, Woodsman } from './rules.js';

/**
 * Lumberjack — a tree each, and a branch on the wrong side ends your rhythm.
 *
 * The rules module holds the whole simulation. What lives here is how a person expresses
 * "that side" through it, and how two yards are drawn one above the other.
 */

const COLOUR_NIGHT = '#080d0a';
/** The near seat's yard is the lighter of the two, so which half is yours survives grey. */
const COLOUR_YARD_NEAR = '#1d2c22';
const COLOUR_YARD_FAR = '#0d161c';
const COLOUR_GROUND = '#3a2c1d';
const COLOUR_GROUND_LINE = '#584330';
const COLOUR_BARK = '#8a5f36';
const COLOUR_BARK_DEEP = '#5d3f22';
const COLOUR_RING = 'rgba(20, 12, 6, 0.55)';
const COLOUR_CUT_LINE = 'rgba(246, 240, 224, 0.42)';
const COLOUR_DIVIDER = '#f6f0e0';
const COLOUR_INK = '#0b0f0c';
const COLOUR_BONE = '#f6f0e0';
const COLOUR_TRACK = 'rgba(8, 13, 10, 0.72)';

/** Half the box, which is one seat's yard. */
const HALF_HEIGHT = YARD_HEIGHT / 2;
const CENTRE_X = YARD_WIDTH / 2;

/** Everything below is in the *near* seat's frame; {@link flipX} puts the far seat's in. */
const GROUND_Y = 950;
const SEGMENT_HEIGHT = 56;
const TRUNK_HALF = 44;
const BRANCH_REACH = 106;
const BRANCH_HALF_THICK = 11;
const STAND_OFFSET = 132;
const BODY_HALF = 27;
const BODY_HEIGHT = 66;
const HEAD_RADIUS = 19;
const AXE_HEAD = 15;

const BAR_LEFT = 46;
const BAR_RIGHT = YARD_WIDTH - 46;
const BAR_Y = 972;
const BAR_HEIGHT = 16;
const BAR_TICK_LOGS = 10;

/**
 * How much of a swing the falling tree takes to land.
 *
 * The drop is what makes a swing legible: the trunk is drawn one segment high the instant
 * the axe lands and slides into place over the first third of the next cooldown, so a
 * player sees the tree move rather than the picture change.
 */
const DROP_SHARE = 0.35;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The far seat reads the device upside down, so its yard is the near seat's turned half a
 * turn about the centre of the box.
 *
 * Point symmetry rather than a mirror, and that is the whole of the seat handling: every
 * shape below is authored once in the near seat's frame and mapped through these two.
 * Neither the simulation nor the input mapping knows which presentation is running — the
 * board is symmetric under the rotation, so both seats read their own half upright with
 * nothing rotated and no branch on `context.presentation` anywhere in the game.
 */
function flipX(seat: SeatId, x: number): number {
  return seat === 'p1' ? x : YARD_WIDTH - x;
}

function flipY(seat: SeatId, y: number): number {
  return seat === 'p1' ? y : YARD_HEIGHT - y;
}

function fillRect(
  renderer: Renderer,
  seat: SeatId,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: string,
): void {
  if (seat === 'p1') renderer.rect(x, y, width, height, colour);
  // A rect is anchored at its top-left, and half a turn moves that corner to the far
  // one — so the rotated origin is the *opposite* corner, not the mapped original.
  else renderer.rect(YARD_WIDTH - x - width, YARD_HEIGHT - y - height, width, height, colour);
}

function fillCircle(
  renderer: Renderer,
  seat: SeatId,
  x: number,
  y: number,
  radius: number,
  colour: string,
): void {
  renderer.circle(flipX(seat, x), flipY(seat, y), radius, colour);
}

function stroke(
  renderer: Renderer,
  seat: SeatId,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  colour: string,
): void {
  renderer.line(flipX(seat, x1), flipY(seat, y1), flipX(seat, x2), flipY(seat, y2), width, colour);
}

export class LumberjackGame implements Game {
  readonly #match: Match = createMatch();
  readonly #p1Bot: BotState = createBotState();
  readonly #p2Bot: BotState = createBotState();

  #rng = new Rng(1);
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  /**
   * The side each seat has asked for and not yet spent.
   *
   * A tap that lands mid-swing is *kept* rather than dropped, which matters more than it
   * sounds: without it a player has to press again at the exact moment the cooldown ends,
   * and the game turns into one about timing a press rather than choosing a side. Spent
   * on the swing it releases, so one tap is one log; a key or a finger held down re-asks
   * on every step and so keeps chopping at the cadence.
   */
  #p1Want: Lean = CLEAR;
  #p2Want: Lean = CLEAR;
  #winner: SeatId | 'draw' | null = null;

  /** Read-only view for the tests and the balance harness. Never mutate through it. */
  get match(): Match {
    return this.#match;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    this.#p1Want = CLEAR;
    this.#p2Want = CLEAR;
    resetBotState(this.#p1Bot);
    resetBotState(this.#p2Bot);
    resetMatch(this.#match, this.#rng);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;

    const p1 = this.#wantOf('p1', input, fixedDeltaSeconds);
    const p2 = this.#wantOf('p2', input, fixedDeltaSeconds);
    const swung = stepMatch(this.#match, fixedDeltaSeconds, p1, p2);

    // A latched tap is spent by the swing it released. A bot never latches — it is asked
    // afresh every step — so clearing here costs it nothing.
    if (swung.p1 !== 'idle') this.#p1Want = CLEAR;
    if (swung.p2 !== 'idle') this.#p2Want = CLEAR;

    this.#winner = winnerOf(this.#match);
  }

  #wantOf(seat: SeatId, input: InputState, fixedDeltaSeconds: number): Lean {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      return botSide(
        this.#match,
        seat,
        difficulty,
        seat === 'p1' ? this.#p1Bot : this.#p2Bot,
        fixedDeltaSeconds,
        this.#rng,
      );
    }

    const asked = this.#askedSide(seat, input);
    if (asked !== CLEAR) {
      if (seat === 'p1') this.#p1Want = asked;
      else this.#p2Want = asked;
    }
    return seat === 'p1' ? this.#p1Want : this.#p2Want;
  }

  /**
   * Which side a person is asking for this step, or {@link CLEAR} for nothing.
   *
   * A finger names a side by which half of the box it is in — an absolute choice, because
   * there are only two of them and both are directly under the player's own thumb. It is
   * read from the seat's own frame, so the far seat's left is the device's right: they are
   * looking at the same tree from the other end of the room, and reaching for the branch
   * on their left has to reach for the trunk side that is on their left.
   *
   * Keys need no such mapping, which is the part worth noticing. `A` is seat one's left
   * and `←` is seat two's left whichever way up either of them is sitting, so the
   * keyboard path is the same three lines for both seats and cannot get the mirror wrong.
   */
  #askedSide(seat: SeatId, input: InputState): Lean {
    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      const nearSide = pointer.x < CENTRE_X ? LEFT : RIGHT;
      return seat === 'p1' ? nearSide : nearSide === LEFT ? RIGHT : LEFT;
    }
    const move = seatInput.move.x;
    if (move < 0) return LEFT;
    if (move > 0) return RIGHT;
    return CLEAR;
  }

  getActiveSeat(): SeatId | null {
    // Never: both axes are live at once, so the shell keeps a pointer zone for each seat.
    return null;
  }

  getScore(): MatchScore {
    return { p1: this.#match.p1.cut, p2: this.#match.p2.cut, winner: this.#winner };
  }

  /**
   * A side held across a pause must not chop on the way back in.
   *
   * The engine drops its own keys and pointers on a pause, but the latch above is ours and
   * it survives one, so a player who paused with a finger down would return to a log
   * already felled on the first step.
   */
  onPause(): void {
    this.#p1Want = CLEAR;
    this.#p2Want = CLEAR;
  }

  onResume(): void {
    this.#p1Want = CLEAR;
    this.#p2Want = CLEAR;
  }

  destroy(): void {
    this.#botP1 = null;
    this.#botP2 = null;
    this.#p1Want = CLEAR;
    this.#p2Want = CLEAR;
    this.#winner = null;
    resetBotState(this.#p1Bot);
    resetBotState(this.#p2Bot);
    clearMatch(this.#match);
  }

  /**
   * Draws the state as it stands.
   *
   * The interpolation alpha the contract offers is deliberately not read. Nothing here
   * moves continuously — a swing is an instant and a tree drops a whole segment — so the
   * animation that does exist is driven off the cooldown, which the simulation already
   * carries at full resolution.
   */
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_NIGHT);
    this.#drawYard(renderer, 'p1');
    this.#drawYard(renderer, 'p2');
    // The line between the two yards. Both seats' ground is at their own outer edge, so
    // without it the middle of the screen reads as one very tall sky.
    renderer.rect(0, HALF_HEIGHT - 2, YARD_WIDTH, 4, COLOUR_DIVIDER);
  }

  #drawYard(renderer: Renderer, seat: SeatId): void {
    fillRect(
      renderer,
      seat,
      0,
      HALF_HEIGHT,
      YARD_WIDTH,
      HALF_HEIGHT,
      seat === 'p1' ? COLOUR_YARD_NEAR : COLOUR_YARD_FAR,
    );
    fillRect(renderer, seat, 0, GROUND_Y, YARD_WIDTH, YARD_HEIGHT - GROUND_Y, COLOUR_GROUND);
    stroke(renderer, seat, 0, GROUND_Y, YARD_WIDTH, GROUND_Y, 3, COLOUR_GROUND_LINE);

    this.#drawTrunk(renderer, seat);
    this.#drawWoodsman(renderer, seat);
    this.#drawTally(renderer, seat);
  }

  /**
   * The visible stack, from the shoulder up.
   *
   * Drawn one segment high and sliding down over the first {@link DROP_SHARE} of the
   * cooldown, so the tree is seen to fall rather than to teleport. The lift is one segment
   * exactly, which is why the top of the stack is set one segment clear of the divider.
   */
  #drawTrunk(renderer: Renderer, seat: SeatId): void {
    const woodsman = seat === 'p1' ? this.#match.p1 : this.#match.p2;
    const dropped = clamp01(this.#swingProgress(woodsman) / DROP_SHARE);
    const lift = (1 - dropped) * SEGMENT_HEIGHT;

    for (let level = 0; level < VISIBLE_SEGMENTS; level += 1) {
      const top = GROUND_Y - (level + 1) * SEGMENT_HEIGHT - lift;
      fillRect(
        renderer,
        seat,
        CENTRE_X - TRUNK_HALF,
        top,
        TRUNK_HALF * 2,
        SEGMENT_HEIGHT,
        COLOUR_BARK,
      );
      // A ring at every joint: the trunk has to read as a stack of logs rather than a
      // post, or nothing on screen says how far the next swing moves it.
      stroke(
        renderer,
        seat,
        CENTRE_X - TRUNK_HALF,
        top,
        CENTRE_X + TRUNK_HALF,
        top,
        2,
        COLOUR_RING,
      );

      const branch = segmentAt(this.#match.trunk, woodsman.cut + level);
      if (branch === CLEAR) continue;
      const middle = top + SEGMENT_HEIGHT / 2;
      const inner = CENTRE_X + branch * TRUNK_HALF;
      const outer = CENTRE_X + branch * (TRUNK_HALF + BRANCH_REACH);
      fillRect(
        renderer,
        seat,
        Math.min(inner, outer),
        middle - BRANCH_HALF_THICK,
        BRANCH_REACH,
        BRANCH_HALF_THICK * 2,
        COLOUR_BARK_DEEP,
      );
      // A stub angled back towards the trunk, so a branch is a branch in silhouette and
      // not a plank. Cheap, and it is what makes the shape read at a glance.
      stroke(
        renderer,
        seat,
        outer,
        middle - BRANCH_HALF_THICK,
        inner,
        middle - SEGMENT_HEIGHT * 0.36,
        7,
        COLOUR_BARK_DEEP,
      );
    }

    // Where the axe will bite. Not a hint about which side is safe — the branches are the
    // only thing that says that — but it does tell a new player which log is next.
    const cut = GROUND_Y - SEGMENT_HEIGHT - lift;
    stroke(
      renderer,
      seat,
      CENTRE_X - TRUNK_HALF - 8,
      cut,
      CENTRE_X + TRUNK_HALF + 8,
      cut,
      2,
      COLOUR_CUT_LINE,
    );
  }

  /** How far through the current swing or recovery this woodsman is, in [0, 1]. */
  #swingProgress(woodsman: Readonly<Woodsman>): number {
    return woodsman.span <= 0 ? 1 : clamp01(1 - woodsman.cooldown / woodsman.span);
  }

  /**
   * The woodcutter, standing or flattened.
   *
   * Rule 7: the near seat's is round-headed and swings a solid axe; the far seat's is
   * square-headed with a barred one. Two figures at opposite ends of a screen are rarely
   * confused, but a screenshot in greyscale still has to say which is which, and so does
   * a player who cannot tell red from blue.
   */
  #drawWoodsman(renderer: Renderer, seat: SeatId): void {
    const woodsman = seat === 'p1' ? this.#match.p1 : this.#match.p2;
    const palette = SEAT_PALETTE[seat];
    const x = CENTRE_X + woodsman.side * STAND_OFFSET;

    if (woodsman.stunned) {
      this.#drawFelled(renderer, seat, woodsman, x, palette.deep);
      return;
    }

    fillRect(
      renderer,
      seat,
      x - BODY_HALF,
      GROUND_Y - BODY_HEIGHT,
      BODY_HALF * 2,
      BODY_HEIGHT,
      palette.base,
    );
    const headY = GROUND_Y - BODY_HEIGHT - HEAD_RADIUS;
    if (seat === 'p1') {
      fillCircle(renderer, seat, x, headY, HEAD_RADIUS, palette.base);
      fillCircle(renderer, seat, x, headY, HEAD_RADIUS - 7, palette.deep);
    } else {
      fillRect(
        renderer,
        seat,
        x - HEAD_RADIUS,
        headY - HEAD_RADIUS,
        HEAD_RADIUS * 2,
        HEAD_RADIUS * 2,
        palette.base,
      );
      fillRect(
        renderer,
        seat,
        x - HEAD_RADIUS + 7,
        headY - HEAD_RADIUS + 7,
        HEAD_RADIUS * 2 - 14,
        HEAD_RADIUS * 2 - 14,
        palette.deep,
      );
    }

    this.#drawAxe(renderer, seat, woodsman, x, palette.deep);
  }

  /**
   * The axe, raised at the start of a cooldown and biting at the end of it.
   *
   * This is the only clock in the game a player is ever shown, and it is the one that
   * matters: the axe arrives exactly when the next log comes off, so the cadence
   * quickening under a growing streak is watched rather than felt for.
   */
  #drawAxe(
    renderer: Renderer,
    seat: SeatId,
    woodsman: Readonly<Woodsman>,
    x: number,
    colour: string,
  ): void {
    const progress = this.#swingProgress(woodsman);
    const shoulderX = x - woodsman.side * 6;
    const shoulderY = GROUND_Y - BODY_HEIGHT + 14;
    const raisedX = x + woodsman.side * 42;
    const raisedY = GROUND_Y - BODY_HEIGHT - 58;
    const bittenX = CENTRE_X + woodsman.side * (TRUNK_HALF + 10);
    const bittenY = GROUND_Y - SEGMENT_HEIGHT / 2;
    const headX = raisedX + (bittenX - raisedX) * progress;
    const headY = raisedY + (bittenY - raisedY) * progress;

    stroke(renderer, seat, shoulderX, shoulderY, headX, headY, 7, COLOUR_BONE);
    fillRect(
      renderer,
      seat,
      headX - AXE_HEAD,
      headY - AXE_HEAD / 2,
      AXE_HEAD * 2,
      AXE_HEAD,
      colour,
    );
    // The far seat's axe head is barred rather than solid, so the two differ by pattern
    // as well as by colour even when they are both mid-swing on the same side.
    if (seat === 'p2') {
      stroke(
        renderer,
        seat,
        headX,
        headY - AXE_HEAD / 2,
        headX,
        headY + AXE_HEAD / 2,
        4,
        COLOUR_BONE,
      );
    }
  }

  /**
   * Knocked flat, and how long there is left of it.
   *
   * The figure lies down, so being clouted is legible in silhouette; the cross over it and
   * the bar at the feet say the same thing twice more, in shape and in length rather than
   * in colour, because "you are out of this for a second and a half" is the single most
   * important thing the screen ever has to tell a player.
   */
  #drawFelled(
    renderer: Renderer,
    seat: SeatId,
    woodsman: Readonly<Woodsman>,
    x: number,
    colour: string,
  ): void {
    const outward = woodsman.side;
    const top = GROUND_Y - BODY_HALF * 2;
    const left = x - (outward > 0 ? 0 : BODY_HEIGHT);
    fillRect(renderer, seat, left, top, BODY_HEIGHT, BODY_HALF * 2, colour);
    fillCircle(
      renderer,
      seat,
      x + outward * (BODY_HEIGHT + HEAD_RADIUS - 6),
      GROUND_Y - BODY_HALF,
      HEAD_RADIUS,
      colour,
    );

    const middleX = x + outward * BODY_HEIGHT * 0.5;
    const middleY = GROUND_Y - BODY_HALF;
    stroke(renderer, seat, middleX - 18, middleY - 18, middleX + 18, middleY + 18, 6, COLOUR_BONE);
    stroke(renderer, seat, middleX - 18, middleY + 18, middleX + 18, middleY - 18, 6, COLOUR_BONE);

    const barLeft = CENTRE_X - 74;
    const recovered = clamp01(1 - woodsman.cooldown / STUN_SECONDS);
    fillRect(renderer, seat, barLeft, GROUND_Y + 6, 148, 8, COLOUR_TRACK);
    fillRect(renderer, seat, barLeft, GROUND_Y + 6, 148 * recovered, 8, COLOUR_BONE);
  }

  /**
   * Logs felled, as a bar up the seat's own ground.
   *
   * The shell's HUD prints both scores as numbers. What it cannot give a player mid-swing
   * is *how close the race is* without reading two of them, so each seat's bar fills from
   * its own outer edge and the ticks are every ten logs, which is what the eye counts.
   */
  #drawTally(renderer: Renderer, seat: SeatId): void {
    const woodsman = seat === 'p1' ? this.#match.p1 : this.#match.p2;
    const palette = SEAT_PALETTE[seat];
    const span = BAR_RIGHT - BAR_LEFT;
    const filled = (span * Math.min(woodsman.cut, TARGET_LOGS)) / TARGET_LOGS;

    fillRect(renderer, seat, BAR_LEFT, BAR_Y, span, BAR_HEIGHT, COLOUR_TRACK);
    fillRect(renderer, seat, BAR_LEFT, BAR_Y, filled, BAR_HEIGHT, palette.base);
    if (seat === 'p2') {
      // Hatched rather than solid — rule 7 again, so the two bars differ by pattern.
      for (let x = BAR_LEFT + 5; x < BAR_LEFT + filled; x += 11) {
        fillRect(renderer, seat, x, BAR_Y, 3, BAR_HEIGHT, COLOUR_INK);
      }
    }
    for (let log = BAR_TICK_LOGS; log < TARGET_LOGS; log += BAR_TICK_LOGS) {
      const x = BAR_LEFT + (span * log) / TARGET_LOGS;
      stroke(renderer, seat, x, BAR_Y - 4, x, BAR_Y + BAR_HEIGHT + 4, 2, COLOUR_DIVIDER);
    }
  }
}
