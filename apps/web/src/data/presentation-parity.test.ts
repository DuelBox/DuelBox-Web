import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  Canvas2DRenderer,
  DEFAULT_BINDINGS,
  InputManager,
  InputView,
  NO_INSETS,
  Rng,
  envelopeFor,
  fitViewport,
  otherSeat,
  seatView,
  toScreen,
  vec2,
  type Canvas2DLike,
  type LogicalSize,
  type Presentation,
  type SeatId,
  type ZoneSplit,
} from '@duelbox/engine';
import type {
  Game,
  GameContext,
  GameManifest,
  InputState,
  MatchScore,
} from '@duelbox/game-sdk';
import { LOADERS_FOR_TEST, type LoadedGame } from './registry';

/**
 * Shared-screen and single-seat must step the identical match.
 *
 * `docs/presentation.md` is the spec: "Rules, scoring and simulation are byte-identical
 * across both. Only placement, rotation and control mapping change." Forty-nine open issues
 * ask for the single-seat presentation and every one of them lists "rules and simulation are
 * identical across presentations, verified by an input-trace test" in its acceptance
 * criteria. Until this file, nothing in the repository verified it — `cross-viewport.test.ts`
 * proves a phone and a laptop step the same match, and no test at all varied the
 * presentation.
 *
 * This is that test, in the same shape: one seeded trace, several arms, and `toEqual` on raw
 * values rather than a tolerance, because nearly the same diverges by the hundredth step.
 *
 * ## Why the trace is built the way it is
 *
 * The obvious harness — replay one device-space input trace under both presentations — is
 * wrong, and measurably so: when it was tried, twenty-four of the seventy-nine games that
 * existed then "failed" it, and every one of those failures was the spec working as designed.
 * Shared-screen turns the board 180° to face whoever has the move, so the *same tap in device
 * space names a different square*; Road Dodge and Rat Race mirror the far seat's steering for
 * the same reason. That is the control mapping the spec explicitly allows to differ, not a
 * rules difference, and a test that called it a bug would need a two-dozen-game excuse list
 * and would be worth nothing.
 *
 * So the trace is built to mean the same thing in both presentations:
 *
 * - **The local seat is driven by hand and the far seat by a bot.**
 *   `seatView(localSeat, presentation, localSeat)` is `rotated: false` under *both*
 *   presentations, so the local seat's control mapping is identical across the arms by
 *   construction, and the bot reads simulation state rather than the device.
 * - **Input waits for the board to settle.** Shared-screen suppresses input while the board
 *   turns (`SeatFlip.acceptsInput`) and single-seat never turns at all, so an event delivered
 *   mid-flip lands in one arm and is dropped in the other. The harness therefore emits
 *   nothing until the active seat has held still for {@link SETTLE_GUARD} steps. The gate is
 *   computed from `getActiveSeat()` — simulation state, identical in both arms for as long as
 *   parity holds — so it cannot itself smuggle a difference in.
 * - **A second arm removes the hand entirely.** Both seats bot, no pointer and no keys at
 *   all. Nothing a presentation is allowed to touch is left in the loop, so any divergence
 *   there is unambiguous.
 * - **A fourth arm puts a hand on the far seat.** Every arm above it seats a bot there, and a
 *   bot branch returns before the per-seat input read, so a rule that differed by presentation
 *   anywhere on the far seat's *human* path was invisible to all of them — and the far seat is
 *   the only seat a presentation rotates, while two humans on one device is *the* shared-screen
 *   configuration. {@link FAR_SEAT_FRAMES} is the whole of how that arm is made comparable, and
 *   it is worth reading before trusting this file.
 *
 * None of that applies to the runtime-switch question at the bottom of this file, which
 * compares two runs of the *same* starting presentation. There the control mapping is
 * identical between the runs by definition, so that arm can use — and does use — the raw
 * ungated storm on both seats, which is a far sharper instrument.
 *
 * ## Nothing here is a hand-maintained list of games
 *
 * Eight packages were scaffolded while this file was being written and were being filled in
 * by other agents as it ran; one of them grew from 58 lines to 720 between two runs of this
 * suite. A constant naming them would have been wrong within the hour, and the earlier
 * version of this file proved it — it carried six ids under the heading "have no rules yet"
 * that were 361-to-614-line finished games by the time anyone read it, and excluding them
 * cost six games' coverage in every arm and in the device-global scan for nothing.
 *
 * So membership is *computed*. A game whose trace never moves under any driver is inert:
 * it is reported by id on every run and skipped, because comparing two frozen traces proves
 * nothing either way, and it is skipped for exactly as long as it stays frozen. The same
 * rule decides the per-arm guards — an arm whose driver produced a flat trace is dropped
 * from that game's comparison and named in the report, rather than being carried by a
 * sibling arm that did move.
 *
 * ## The gestures are generic, and for some games they are generic enough to do nothing
 *
 * The script taps, drags for six steps and holds a key. That is a real gesture for most of the
 * collection and no gesture at all for some of it: for thirteen games the human arm is
 * byte-identical to the same arm with no hands on it, which makes it a bots arm wearing a
 * different label. Whack-a-Mole, Sea Battle and Rat Race are on that list, and Rat Race is one
 * of the two games this header names as mirroring far-seat steering.
 *
 * Writing a bespoke gesture script per game is a larger piece of work than this file, and
 * doing it badly would be worse than not doing it. What is not optional is *knowing*: both
 * hands are re-run with no input at all, and every game whose trace does not notice is printed
 * by id on every run. A gap somebody can see is a gap somebody can close.
 *
 * ## What the trace records
 *
 * Score, winner, active seat — the whole of a game's observable simulation surface — plus the
 * number of RNG draws the game has taken. The draw count is the cheap half of the strength
 * here: two matches can hold the same score for a hundred steps while consuming randomness
 * differently, and that divergence is invisible to the score alone. Draws taken during
 * `render` are deliberately not counted, since rendering is exactly the thing that is
 * *allowed* to differ between presentations.
 */

const STEP = 1 / 60;
const STEPS = 900;

/**
 * Steps the active seat must hold still before the harness will send anything.
 *
 * The board flip is the reason. `SeatFlip`'s default half-turn is 0.36 s — 22 steps — and the
 * two games that override it (Ship Battle and Hammer Hit, at 0.24 s) are shorter, so 40 steps
 * clears the longest flip in the repository by nearly a factor of two. Nothing here reads a
 * game's flip duration, and it does not need to: a game whose flip ran longer than this gate
 * would show up as a divergence rather than pass quietly, and `the settle gate is not what
 * decides the answer` below re-runs every turn-based game at double the gate to prove the
 * number is not doing the work.
 */
const SETTLE_GUARD = 40;

/** One viewport, fixed. Viewport-independence is `cross-viewport.test.ts`'s job, not this one. */
const VIEWPORT = { width: 1280, height: 800 } as const;

type ArmName = 'human' | 'bots' | 'remote' | 'far-hand';

/**
 * Everything the run wants to say out loud, collected as the tests go and printed at the end
 * of each describe.
 *
 * Gathered rather than asserted because none of it is a failure — it is the shape of what
 * this file could and could not measure today, which is the first thing the next reader needs
 * and the last thing a green tick tells them.
 */
const REPORT = {
  /** Games whose every driver produced a flat trace, so nothing may be read into them. */
  inert: [] as string[],
  /** `id/arm` pairs named because that arm's driver produced a flat trace. */
  deadArms: [] as string[],
  /** The same, for the runtime-switch describe, which reports separately at its own end. */
  deadSwitchArms: [] as string[],
  /** Games where the scripted hand changes nothing: the arm is a relabelled bots arm. */
  deadLocalHand: [] as string[],
  /** The same for the far seat's hand in the far-seat arm. */
  deadFarHand: [] as string[],
  /** Which of {@link FAR_SEAT_FRAMES} each game turned out to need. */
  farFrames: [] as string[],
  /** Games where the far-seat arm is approximate rather than exact: see latticeSurvivesTurn. */
  farApproximate: [] as string[],
};

function reportLines(label: string, ids: readonly string[]): string {
  return ids.length === 0 ? `${label}: none` : `${label} (${String(ids.length)}): ${ids.join(', ')}`;
}

/**
 * Games that fail an arm today, with the reason. Printed on every run.
 *
 * All three are the same defect, and it is a real one rather than an artefact of this
 * harness. `if (!flip.acceptsInput) return;` is an early return out of the *whole* of
 * `update`, and everything a turn consists of sits below it: the shot clock, the bot's draw,
 * and the seat's input alike. Shared-screen turns the board on every change of turn and
 * single-seat never turns at all, so each turn change costs the shared-screen arm the
 * flip's 0.36 s — 22 fixed steps — of simulation that the single-seat arm spends. In Archery
 * that is not a rounding difference: over the same 900 steps the same trace scored 8–32
 * shared-screen and 0–32 single-seat.
 *
 * **The clock is not the whole cause, and moving it is not the fix.** An earlier reading of
 * this blamed the shot clock alone and proposed counting it down above the gate. That was
 * tried: with `this.#clockSteps -= 1;` lifted above the guard the divergence survives
 * unchanged, because the same early return is still swallowing roughly 22 steps of *bot*
 * progress per turn change — `#botStep` is below the gate too, and a bot that may not act on
 * a step a person may not act on (CLAUDE.md rule 6) is the deliberate design. Making the two
 * presentations agree means deciding what the flip is allowed to stop, not moving one line:
 * either nothing below the gate may be simulation, or single-seat owes shared-screen an
 * equivalent settle pause. That is a fairness decision about whose 0.36 s it is, and it
 * belongs on the issue rather than in a test's stride.
 *
 * These assertions are inverted: a game listed here must *still* diverge. Fix one and this
 * file goes red telling you to delete the entry, so a stale excuse cannot outlive its bug.
 */
const KNOWN_DIVERGENCES: ReadonlyMap<string, { readonly arms: readonly ArmName[]; readonly why: string }> =
  new Map([
    [
      'archery',
      {
        arms: ['human', 'bots'],
        why: 'the flip gate returns out of the whole turn, so shared-screen spends 0.36s per turn change that single-seat does not (scored 8-32 vs 0-32 on the same trace)',
      },
    ],
    [
      'archery-master',
      {
        arms: ['human', 'bots', 'far-hand'],
        why: "same frozen turn; its own comment claims the flip changes 'nothing about what happens', and two bots finish 14-12 shared-screen against 18-12 single-seat. The only game the far-seat arm cannot find a control mapping for either, for the same reason: the loss is steps, not coordinates",
      },
    ],
    [
      'soccer-pool',
      {
        arms: ['human', 'bots'],
        why: 'same frozen turn; the sequence of events matches but every one of them lands on a different step',
      },
    ],
  ]);

/**
 * Globals that could only ever answer a question about the device (CLAUDE.md rule 10).
 *
 * ESLint's `no-restricted-globals` already refuses the bare identifiers, but it sees only
 * bare identifiers: `globalThis.navigator`, `window.innerWidth` and `screen['width']` all
 * walk straight past it, and `userAgent`, `ontouchstart` and `maxTouchPoints` are not on its
 * list at all. This closes both gaps and does it on the source text, so it holds for anything
 * a game could write rather than for the shapes one rule happens to model.
 */
const DEVICE_GLOBALS =
  /\b(?:navigator|matchMedia|userAgent|userAgentData|ontouchstart|onorientationchange|maxTouchPoints|devicePixelRatio|innerWidth|innerHeight|outerWidth|outerHeight|visualViewport|localStorage|sessionStorage|indexedDB|document|globalThis)\b|\b(?:window|screen)\s*[.[]/g;

const GAMES_ROOT = join(__dirname, '../../../../packages/games');

/** The newest modification time under a directory, or 0 if it is not there at all. */
function newestUnder(dir: string, keep: (file: string) => boolean): number {
  let latest = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) latest = Math.max(latest, newestUnder(full, keep));
    else if (keep(entry.name)) latest = Math.max(latest, statSync(full).mtimeMs);
  }
  return latest;
}

/**
 * When this package was last built, by TypeScript's own reckoning.
 *
 * The `.tsbuildinfo` and not the newest file in `dist`: `tsc --build` leaves an emitted file
 * alone when its content has not changed — an edit to a comment recompiles to identical
 * JavaScript — so asking `dist` reports every such package as behind forever. Zero means
 * there is no build at all.
 */
function buildStamp(id: string): number {
  try {
    return statSync(join(GAMES_ROOT, id, 'tsconfig.build.tsbuildinfo')).mtimeMs;
  } catch {
    return newestUnder(join(GAMES_ROOT, id, 'dist'), () => true);
  }
}

/**
 * Playable games whose source has moved since the copy this file played.
 *
 * **The two halves of this file read different copies of the same game.** The simulation arms
 * import from `dist`, because that is what the registry's dynamic imports resolve to; the
 * device-global scan reads `src`, because that is where a device global is written and where a
 * line number means anything. They agree only while `dist` is built — so a source edit that
 * has not been compiled is invisible to every parity assertion above, which is the exact shape
 * of the mistake somebody makes when they change a game to watch this file go red and it stays
 * green. This is printed by name, with the command that fixes it, on every run.
 *
 * Printed rather than failed, and the reason is not squeamishness. CI's own `pnpm typecheck`
 * runs `tsc --build` before `pnpm test`, so in CI this list is empty by construction; the only
 * time it fills is on a working tree where somebody — possibly somebody else, in a monorepo
 * where an engine change touches thirty games — has edited source they have not compiled yet.
 * Turning that into a red build makes one person's uncommitted edit everybody's failure, which
 * is how a check gets deleted. A missing build is a different matter and does fail, below.
 *
 * `tsconfig.build.json` excludes `src/**\/*.test.ts`, so an edited test file is not a stale
 * build and must not read as one — that misfire is the other way this check gets switched off.
 */
function staleBuilds(): string[] {
  const compiled = (file: string): boolean => file.endsWith('.ts') && !file.endsWith('.test.ts');
  return Object.keys(LOADERS_FOR_TEST)
    .filter((id) => newestUnder(join(GAMES_ROOT, id, 'src'), compiled) > buildStamp(id))
    .map((id) => `${id} (npx tsc --build packages/games/${id}/tsconfig.build.json)`);
}

/** Everything playable. There is no skip list; see the header. */
const SUBJECTS = Object.entries(LOADERS_FOR_TEST);

/**
 * A canvas context that answers every call and records nothing.
 *
 * A proxy rather than a hand-written stub, for the reason `cross-viewport.test.ts` gives: a
 * listed stub fails the day a game reaches for a method nobody listed, which is a fact about
 * the stub and not about the simulation.
 */
function stubContext(): Canvas2DLike {
  const noop = (): unknown => undefined;
  const measure = (): TextMetrics => ({ width: 0 }) as TextMetrics;
  return new Proxy(
    {},
    {
      get: (_target, property) => (property === 'measureText' ? measure : noop),
      set: () => true,
    },
  ) as unknown as Canvas2DLike;
}

/**
 * The seeded generator, counting how many draws the simulation has taken.
 *
 * Every other draw method routes through `next`, so overriding it alone catches all of them.
 * `counting` is off during `render` on purpose: a game may legitimately draw differently in
 * the two presentations, and randomness spent on drawing is not simulation state.
 */
class CountingRng extends Rng {
  draws = 0;
  counting = false;

  override next(): number {
    if (this.counting) this.draws += 1;
    return super.next();
  }
}

/**
 * Which frame a scripted gesture aimed at a rotated seat is expressed in.
 *
 * `'device'` means the coordinates and key codes are what the hardware saw; `'world'` means
 * they are what the seat meant, and the harness turns them on the way out.
 */
type GestureFrame = 'device' | 'world';

interface Arm {
  readonly presentation: Presentation;
  readonly localSeat: SeatId;
  /**
   * Who is at the controls.
   *
   * `'local-hand'` drives the local seat only, through the settle gate, so the arm is
   * comparable across presentations. `'ungated-storm'` is the raw storm on both seats with no
   * gate at all — not comparable across presentations, and never used that way, but the most
   * sensitive instrument there is for comparing two runs of the *same* presentation.
   */
  readonly hands: 'local-hand' | 'both-seats' | 'ungated-storm' | 'none';
  readonly botSeats: readonly SeatId[];
  /**
   * How a `'both-seats'` gesture aimed at a *rotated* seat is written into device space.
   *
   * `'device'` sends the same device coordinates and the same key codes in both
   * presentations. `'world'` treats the scripted gesture as living in the **seat's own**
   * frame and turns it through {@link seatView} on the way out: the pointer goes through
   * `toScreen`, and a direction key becomes the opposite direction key.
   *
   * The two channels carry their own setting because games map them independently, and
   * three of them do. See {@link FAR_SEAT_FRAMES}.
   */
  readonly farPointerFrame?: GestureFrame;
  readonly farKeyFrame?: GestureFrame;
  /** Step at which the presentation flips underneath the running match, if it does. */
  readonly flipAt?: number;
  readonly settleGuard?: number;
}

/** One step of the recorded signature: everything the contract lets an outsider observe. */
type Frame = readonly [number, number, MatchScore['winner'], SeatId | null, number];

/**
 * Play one match and return its per-step signature.
 *
 * The shell's own behaviour is reproduced where it is load-bearing: a turn game is handed the
 * whole pointer surface for whoever is to move (`GameHost` does exactly this), because
 * without it seventeen turn games take no pointer input at all and the trace proves nothing
 * about them. Everything the harness decides is derived from the manifest or from simulation
 * state, never from the presentation — the one exception being the far seat's own frame,
 * which is what {@link FAR_SEAT_FRAMES} is about and is the one thing the spec says *must*
 * be allowed to differ.
 */
function drive(manifest: GameManifest, create: () => Game, arm: Arm): Frame[] {
  const logical = manifest.logical;
  const renderer = new Canvas2DRenderer(stubContext(), logical);
  renderer.setViewport(fitViewport(logical, VIEWPORT.width, VIEWPORT.height, NO_INSETS));

  const zoned: ZoneSplit = manifest.zoneSplit === 'vertical' ? 'vertical' : 'horizontal';
  const input = new InputManager(logical, { split: zoned, bottomSeat: arm.localSeat });
  const view = new InputView();
  const guard = arm.settleGuard ?? SETTLE_GUARD;

  // Read through a getter rather than copied into the object, so a game that re-read
  // `context.presentation` during `update` would see a mid-match flip. Every game in the
  // repository snapshots it at `init` instead, which is why the flip is a no-op today — and
  // is exactly the thing docs/presentation.md flags as "untested rather than known-good".
  let presentation = arm.presentation;
  const rng = new CountingRng(20260820);
  const context: GameContext = {
    manifest,
    rng,
    get presentation() {
      return presentation;
    },
    localSeat: arm.localSeat,
    openingSeat: 'p1',
    botDifficulty: (seat) => (arm.botSeats.includes(seat) ? 'normal' : null),
  };

  const game = create();
  game.init(context);

  const script = new Rng(7);
  const trace: Frame[] = [];
  const far = otherSeat(arm.localSeat);
  const point = vec2();
  let previousSeat: SeatId | null | undefined;
  let stable = 0;
  let pointerId = -1;
  let pointerSteps = 0;
  let keySteps = 0;
  let farKeySteps = 0;
  let farKeyCode = '';

  /**
   * Deliver one gesture *from* a named seat, whatever the zone map says.
   *
   * Ownership is claimed at `pointerDown` and held until release, so setting the board seat
   * for the length of that one call routes the press and leaves everything else alone. It
   * has to be done this way: under `'world'` the far seat's device point is the 180° turn of
   * its world point, which lands in the *other* seat's zone, and the single-seat arm has no
   * zone map to speak of anyway — the far seat is a different device, and its press arrives
   * over the wire already owned.
   */
  function press(
    seat: SeatId,
    id: number,
    worldX: number,
    worldY: number,
    restore: { readonly split: ZoneSplit; readonly board: SeatId },
  ): void {
    const turn =
      arm.farPointerFrame === 'world' && seatView(seat, presentation, arm.localSeat).rotated;
    toScreen(point, worldX, worldY, logical, turn);
    input.setSplit('shared');
    input.setBoardSeat(seat);
    input.pointerDown(id, point.x, point.y);
    input.setSplit(restore.split);
    input.setBoardSeat(restore.board);
  }

  /**
   * Drop every held press at the gate, the way losing focus does.
   *
   * `pointerUp` and `keyUp` would be the obvious way and they are wrong, because a release is
   * *itself* an input event: it raises `actionReleased` on the very step the active seat
   * changed, which is the one step shared-screen is turning the board through and dropping
   * everything it is handed. Cornhole throws its bag on that edge, so the single-seat arm
   * threw a bag the shared arm never did and the harness reported its own gate as a rules
   * difference. `clear()` is the engine's answer to exactly this — "a window that loses focus
   * mid-charge must not deliver a release the player never made" — and it zeroes the edges
   * with the sources, so neither arm sees anything at all.
   */
  function letGo(): void {
    input.clear();
    pointerId = -1;
    pointerSteps = 0;
    keySteps = 0;
    farKeySteps = 0;
  }

  /** The far seat's key for an intent, turned through its own frame like the pointer is. */
  function farKey(slot: 'up' | 'action'): string {
    const binding = DEFAULT_BINDINGS[far];
    // The action key names no direction, so no presentation can map it two ways.
    if (slot === 'action') return binding.action;
    const turn =
      arm.farKeyFrame === 'world' && seatView(far, presentation, arm.localSeat).rotated;
    return turn ? binding.down : binding.up;
  }

  for (let step = 0; step < STEPS; step += 1) {
    if (arm.flipAt === step) {
      presentation = presentation === 'shared-screen' ? 'single-seat' : 'shared-screen';
    }

    const active = game.getActiveSeat?.() ?? null;
    stable = active === previousSeat ? stable + 1 : 0;
    previousSeat = active;
    const split: ZoneSplit = active === null ? zoned : 'shared';
    input.setSplit(split);
    input.setBoardSeat(active ?? arm.localSeat);

    if (arm.hands === 'both-seats') {
      if (stable < guard) {
        letGo();
      } else {
        if (pointerId >= 0) {
          pointerSteps += 1;
          if (pointerSteps >= 6) {
            input.pointerUp(pointerId);
            pointerId = -1;
          }
        } else if (step % 17 === 0) {
          pointerId = step % 3;
          pointerSteps = 0;
          // Whose gesture this is, decided before the coordinates are drawn so the draw
          // order is the same in both arms. A turn game's board belongs to whoever is to
          // move; a real-time game's two seats take it in turns from the script.
          const owner = active ?? (script.float() < 0.5 ? arm.localSeat : far);
          const x = script.float() * logical.width;
          const y = script.float() * logical.height;
          press(owner, pointerId, x, y, { split, board: active ?? arm.localSeat });
        }
        // The local seat keeps the key it has in every other arm, and the far seat gets
        // one of its own — a direction, which a rotated seat reads turned around, and the
        // action key, which carries no frame at all and is the same press either way.
        if (keySteps > 0) {
          keySteps += 1;
          if (keySteps >= 9) {
            input.keyUp('KeyW');
            keySteps = 0;
          }
        } else if (step % 23 === 0) {
          input.keyDown('KeyW');
          keySteps = 1;
        }
        if (farKeySteps > 0) {
          farKeySteps += 1;
          if (farKeySteps >= 7) {
            input.keyUp(farKeyCode);
            farKeySteps = 0;
          }
        } else if (step % 13 === 0) {
          farKeyCode = step % 26 === 0 ? farKey('up') : farKey('action');
          input.keyDown(farKeyCode);
          farKeySteps = 1;
        }
      }
    } else if (arm.hands !== 'none') {
      if (arm.hands === 'local-hand' && stable < guard) {
        letGo();
      } else {
        if (pointerId >= 0) {
          pointerSteps += 1;
          if (pointerSteps >= 6) {
            input.pointerUp(pointerId);
            pointerId = -1;
          }
        } else if (step % 17 === 0) {
          pointerId = step % 3;
          pointerSteps = 0;
          const x = script.float() * logical.width;
          const y = script.float() * logical.height;
          input.pointerDown(pointerId, x, y);
        }
        if (keySteps > 0) {
          keySteps += 1;
          if (keySteps >= 9) {
            input.keyUp('KeyW');
            keySteps = 0;
          }
        } else if (step % 23 === 0) {
          input.keyDown('KeyW');
          keySteps = 1;
        }
      }
    }

    rng.counting = true;
    game.update(STEP, view.sync(input.beginStep(STEP)));
    rng.counting = false;
    game.render(renderer, 0);

    const score = game.getScore();
    trace.push([score.p1, score.p2, score.winner, game.getActiveSeat?.() ?? null, rng.draws]);
  }

  game.destroy();
  return trace;
}

/** True when the whole match sat on one frame, so comparing it would prove nothing. */
function isInert(trace: readonly Frame[]): boolean {
  const first = JSON.stringify(trace[0]);
  return trace.every((frame) => JSON.stringify(frame) === first);
}

const SHARED_LOCAL_P1: Arm = {
  presentation: 'shared-screen',
  localSeat: 'p1',
  hands: 'local-hand',
  botSeats: ['p2'],
};
const SINGLE_LOCAL_P1: Arm = { ...SHARED_LOCAL_P1, presentation: 'single-seat' };
const SHARED_BOTS: Arm = {
  presentation: 'shared-screen',
  localSeat: 'p1',
  hands: 'none',
  botSeats: ['p1', 'p2'],
};
const SINGLE_BOTS: Arm = { ...SHARED_BOTS, presentation: 'single-seat' };
const SINGLE_BOTS_P2: Arm = { ...SINGLE_BOTS, localSeat: 'p2' };

/**
 * A hand on **both** seats, gated the way the local-hand arm is, no bots at all.
 *
 * Two humans on one device is *the* shared-screen configuration, and the far seat is the only
 * seat a presentation rotates — so it is the seat that matters most here and the one the other
 * three arms never touch. A bot branch returns before the per-seat input read, which means a
 * rule that differed by presentation anywhere on the far seat's *human* path was invisible to
 * this file: a free-goal mutation in Air Hockey gated on `seat === 'p2' && pointer !== null`
 * ran green here, while the identical line on `p1` ran red.
 */
const BOTH_SEATS: Arm = {
  presentation: 'shared-screen',
  localSeat: 'p1',
  hands: 'both-seats',
  botSeats: [],
};

/**
 * The four control mappings a game may have chosen for its far seat, tried in turn.
 *
 * This is the whole difficulty of driving the far seat, so it is worth stating plainly. For
 * the local seat the harness can send one device-space gesture to both arms and know it means
 * the same thing, because `seatView(localSeat, presentation, localSeat)` is never rotated. For
 * the far seat there is no such luck: shared-screen has that person reading the device upside
 * down and single-seat has them on their own device the right way up, so *some* mapping must
 * differ, and which one is the game's business. `docs/presentation.md` grants exactly this —
 * "only placement, rotation and control mapping change".
 *
 * There is no API that reports a game's choice, and the repository makes all four:
 *
 * - Air Hockey reads the pointer as board space for both seats and mirrors nothing, because a
 *   split court is common ground and each player's end is already the end nearest them.
 * - Tic Tac Toe turns both channels, because the board itself turns.
 * - Whack-a-Mole turns the *keys* and not the pointer: "the board is common ground drawn in
 *   one orientation", but a seat reading it upside down still means the opposite direction by
 *   every arrow key.
 * - Cornhole and Shuriken turn the *pointer* and not the keys.
 *
 * So the harness tries all four and requires that **one of them steps the identical match**.
 * Each is a control mapping the spec allows, so passing under any one of them is the game
 * being consistent under the mapping it chose; a rule that branches on the presentation is
 * additive to the mapping and breaks all four alike, which is what makes this an assertion
 * rather than a rubber stamp. Ordered by how many games need each, so the usual answer costs
 * one comparison. The mapping each game turned out to need is printed on every run — a game
 * that changes its answer is a game whose far-seat controls have been rewired.
 *
 * **Where this arm is approximate, and it is worth knowing which games.** Under `'world'` the
 * pointer is turned with `toScreen` and *then* quantised onto the precision lattice by the
 * engine, and a 180° turn only maps that lattice onto itself when both logical dimensions are
 * a whole number of `envelopeFor(logical)` cells. Most of the collection is not: Archery's
 * 700×1000 box is 200 cells wide and 285.7 tall, so a mirrored aim point lands up to half a
 * cell from where its unmirrored twin lands, and no choice of coordinates can avoid it —
 * `a + b = width` has no solution in whole cells when the width is not a whole number of them.
 * That is an engine asymmetry rather than anything this file can fix (quantise before the
 * turn, not after it), and it is why {@link latticeSurvivesTurn} exists: the games where the
 * far-seat arm is approximate rather than exact are counted and printed, because "it passed"
 * means something weaker for them. It is survivable because the trace records outcomes and not
 * aim vectors, so half a cell of aim rarely changes a ring or a cell — but a game whose result
 * turns on that scale would read as a divergence here rather than pass quietly, which is the
 * right way round for a harness to be wrong.
 */
const FAR_SEAT_FRAMES: readonly { readonly pointer: GestureFrame; readonly keys: GestureFrame }[] =
  [
    { pointer: 'device', keys: 'device' },
    { pointer: 'world', keys: 'world' },
    { pointer: 'device', keys: 'world' },
    { pointer: 'world', keys: 'device' },
  ];

/**
 * Whether a 180° turn about the centre maps the engine's precision lattice onto itself.
 *
 * `InputManager` quantises every pointer onto a lattice of `envelopeFor(logical)` units, and
 * `toWorld` mirrors about the box. The two commute only when the box is a whole number of
 * cells across, which most of the collection is not. See {@link FAR_SEAT_FRAMES}.
 */
function latticeSurvivesTurn(logical: LogicalSize): boolean {
  const cell = envelopeFor(logical);
  return Number.isInteger(logical.width / cell) && Number.isInteger(logical.height / cell);
}

/** The pair of arms for one far-seat mapping: the same gesture under the two presentations. */
function farSeatArms(frames: {
  readonly pointer: GestureFrame;
  readonly keys: GestureFrame;
}): readonly [Arm, Arm] {
  const shared: Arm = { ...BOTH_SEATS, farPointerFrame: frames.pointer, farKeyFrame: frames.keys };
  return [shared, { ...shared, presentation: 'single-seat' }];
}

/**
 * Two children mashing one screen, ungated, both seats live.
 *
 * Only ever compared against *itself* — a run of this against a run of this that switched
 * presentation half way. Comparing it across presentations would be meaningless for the
 * reason the header gives, but for the runtime-switch question it is the sharpest instrument
 * available: every rotation, every zone boundary and every suppressed frame is in play, so a
 * game that noticed the switch has nowhere to hide it.
 */
const SHARED_BOTH_HANDS: Arm = {
  presentation: 'shared-screen',
  localSeat: 'p1',
  hands: 'ungated-storm',
  botSeats: [],
};
const SINGLE_BOTH_HANDS: Arm = { ...SHARED_BOTH_HANDS, presentation: 'single-seat' };

function expectedToDiverge(id: string, arm: ArmName): boolean {
  return KNOWN_DIVERGENCES.get(id)?.arms.includes(arm) ?? false;
}

/**
 * Compare two arms, honouring the exceptions list in both directions.
 *
 * A game not on the list must match. A game on the list must *not* match: the exception is
 * itself asserted, so fixing the game turns this red and names the entry to delete.
 */
function expectParity(
  id: string,
  arm: ArmName,
  a: readonly Frame[],
  b: readonly Frame[],
  what: string,
): void {
  if (expectedToDiverge(id, arm)) {
    expect(
      b,
      `${id} no longer diverges on ${arm} — delete it from KNOWN_DIVERGENCES`,
    ).not.toEqual(a);
    return;
  }
  // Whether this arm's driver moved the game is recorded *per arm*, which is the whole point.
  // The earlier guard was `expect(isInert(a) && isInert(b)).toBe(false)` once at the end, and
  // that is a guard that cannot fail while any one arm moves: Sea Battle's human arm is one
  // frame repeated 900 times and was carried by its bots arm, so "the presentations agree"
  // meant nothing at all for it and nobody could tell. The comparison below still runs — two
  // flat traces that differ are a divergence from step zero and worth catching — but the arm
  // is named as vacuous so nothing rests on its agreement.
  if (isInert(a)) REPORT.deadArms.push(`${id}/${arm}`);
  expect(b, `${id} steps a different match ${what}`).toEqual(a);
}

/**
 * The result of hunting for the far seat's control mapping.
 *
 * `'held'` names the mapping that stepped the identical match. `'broken'` means every mapping
 * was live and every one of them disagreed, which is the finding. `'flat'` means the only
 * mappings that agreed left the game motionless, so the arm measured nothing and says so:
 * Rat Race steers the far seat's car with the opposite arrow key under a rotated seat, and
 * getting that right is what stops the car crossing the line inside 900 steps.
 */
type FarSeatResult =
  | { readonly kind: 'held'; readonly mapping: string }
  | { readonly kind: 'broken' }
  | { readonly kind: 'flat' };

/**
 * Play the far-seat arm under each mapping in turn and return the first that holds.
 *
 * Lazy on purpose: most games answer on the first comparison, and the alternative is four
 * comparisons for every game. A mapping whose trace is flat is passed over rather than
 * counted — two motionless traces agree about nothing, and taking that as the answer is
 * exactly the vacuity this file exists to refuse.
 */
function farSeatMapping(loaded: LoadedGame): FarSeatResult {
  let anyFlat = false;
  for (const frames of FAR_SEAT_FRAMES) {
    const [sharedArm, singleArm] = farSeatArms(frames);
    const shared = drive(loaded.manifest, () => loaded.create(), sharedArm);
    if (isInert(shared)) {
      anyFlat = true;
      continue;
    }
    const single = drive(loaded.manifest, () => loaded.create(), singleArm);
    if (JSON.stringify(shared) === JSON.stringify(single)) {
      return { kind: 'held', mapping: `${frames.pointer}/${frames.keys}` };
    }
  }
  return anyFlat ? { kind: 'flat' } : { kind: 'broken' };
}

describe('the simulation does not depend on the presentation', () => {
  it('says out loud which games are exempt, on every run', () => {
    const lines = [...KNOWN_DIVERGENCES].map(
      ([id, entry]) => `  ${id} [${entry.arms.join(', ')}] — ${entry.why}`,
    );
    console.warn(
      `presentation parity: ${String(KNOWN_DIVERGENCES.size)} game(s) exempt today\n${lines.join('\n')}`,
    );
    // The list is a stopgap, not a design. If it ever grows past a handful, the shape of the
    // problem has changed and somebody needs to look rather than append.
    expect(KNOWN_DIVERGENCES.size).toBeLessThanOrEqual(5);
  });

  for (const [id, load] of SUBJECTS) {
    it(`${id} plays the identical match in both presentations`, async () => {
      const loaded = await load();

      // Arm one: a hand on the local seat, a bot opposite. The local seat's controls map the
      // same way under both presentations, so this is a genuine input trace rather than a
      // comparison of two different control schemes.
      const sharedHuman = drive(loaded.manifest, () => loaded.create(), SHARED_LOCAL_P1);
      const singleHuman = drive(loaded.manifest, () => loaded.create(), SINGLE_LOCAL_P1);
      expectParity(id, 'human', sharedHuman, singleHuman, 'when a person plays the local seat');

      // Arm two: no hand at all, both seats bot. Nothing a presentation may touch is in the
      // loop, so this isolates the rules from the control mapping completely.
      const sharedBots = drive(loaded.manifest, () => loaded.create(), SHARED_BOTS);
      const singleBots = drive(loaded.manifest, () => loaded.create(), SINGLE_BOTS);
      expectParity(id, 'bots', sharedBots, singleBots, 'when two bots play it');

      // Arm three: the remote-play case the forty-nine issues are actually about. Two devices,
      // both single-seat, one holding each seat. They must be stepping one match, not two.
      const singleBotsP2 = drive(loaded.manifest, () => loaded.create(), SINGLE_BOTS_P2);
      expectParity(
        id,
        'remote',
        singleBots,
        singleBotsP2,
        "on the opponent's device rather than this one",
      );

      // Arm four: a hand on the far seat as well, which is the seat the presentation actually
      // rotates and the one the three arms above leave to a bot. See FAR_SEAT_FRAMES.
      const far = farSeatMapping(loaded);
      REPORT.farFrames.push(`${id} ${far.kind === 'held' ? far.mapping : far.kind}`);
      if (
        far.kind === 'held' &&
        far.mapping.startsWith('world') &&
        !latticeSurvivesTurn(loaded.manifest.logical)
      ) {
        REPORT.farApproximate.push(id);
      }
      if (far.kind === 'flat') {
        REPORT.deadArms.push(`${id}/far-hand`);
      } else if (expectedToDiverge(id, 'far-hand')) {
        expect(
          far.kind,
          `${id} now holds on the far seat — delete it from KNOWN_DIVERGENCES`,
        ).toBe('broken');
      } else {
        expect(
          far.kind,
          `${id} steps a different match with a person on the far seat, under every control mapping the spec allows`,
        ).toBe('held');
      }

      // A game that sat still for 900 steps under every driver agrees with itself about
      // nothing. The comparisons above still ran and still had to hold — a placeholder that
      // somehow diverges is a finding — but the game is named as inert so that nothing is
      // read into its agreement. Computed, not listed: it stops being named on the run after
      // it starts moving, which is how eight packages being written by other people while
      // this ran stay covered without anybody maintaining a set of ids.
      if (isInert(sharedHuman) && isInert(sharedBots) && far.kind === 'flat') {
        REPORT.inert.push(id);
      }

      // Does the scripted hand change anything at all? When it does not, the human arm is a
      // relabelled bots arm and the far-seat arm proves nothing about the far seat. Neither is
      // a failure — the gestures are generic and some games want a gesture they never get —
      // but both are invisible unless somebody says so, so both are printed.
      const noLocalHand = drive(loaded.manifest, () => loaded.create(), {
        ...SHARED_LOCAL_P1,
        hands: 'none',
      });
      if (JSON.stringify(sharedHuman) === JSON.stringify(noLocalHand)) {
        REPORT.deadLocalHand.push(id);
      }
      const [withFarHand] = farSeatArms(FAR_SEAT_FRAMES[0]!);
      const noFarHand = drive(loaded.manifest, () => loaded.create(), {
        ...withFarHand,
        hands: 'none',
      });
      if (
        JSON.stringify(drive(loaded.manifest, () => loaded.create(), withFarHand)) ===
        JSON.stringify(noFarHand)
      ) {
        REPORT.deadFarHand.push(id);
      }
    });
  }

  it('covers every playable game, so a new one cannot skip this quietly', () => {
    // `SUBJECTS` is the registry itself, so the only way a game escapes this file is by not
    // being in the registry — a package on disk that nothing loads. `create-game` writes the
    // loader as it scaffolds, so this is a real gate rather than a race with whoever is
    // building the next one.
    const unregistered = readdirSync(GAMES_ROOT)
      .filter((name) => !name.startsWith('.'))
      .filter((name) => !(name in LOADERS_FOR_TEST));
    expect(unregistered, 'these packages exist and no test in this file plays them').toEqual([]);
    expect(SUBJECTS.length).toBeGreaterThanOrEqual(79);

    // Inert games are skipped, so the skip has to be bounded by something: a wholesale
    // breakage — a missing `dist`, a broken loader — would otherwise read as "everything is a
    // placeholder today" and pass in silence.
    expect(
      SUBJECTS.length - REPORT.inert.length,
      `only ${String(SUBJECTS.length - REPORT.inert.length)} games moved at all; something bigger than a scaffold is wrong`,
    ).toBeGreaterThanOrEqual(79);
  });

  it('says out loud what it could and could not measure, on every run', () => {
    const stale = staleBuilds();
    if (stale.length > 0) {
      console.warn(
        `presentation parity PLAYED A STALE BUILD for ${String(stale.length)} game(s) — the arms\nabove ran the compiled copy, not the source the scan reads. Rebuild before believing them:\n  ${stale.join('\n  ')}`,
      );
    }
    console.warn(
      [
        reportLines(
          'presentation parity: inert, so their agreement proves nothing',
          REPORT.inert,
        ),
        reportLines('  arms whose driver never moved the game', REPORT.deadArms),
        reportLines('  scripted local hand changes nothing', REPORT.deadLocalHand),
        reportLines('  scripted far hand changes nothing', REPORT.deadFarHand),
        reportLines('  far-seat arm exact to half a precision cell, not exactly', REPORT.farApproximate),
        `  far-seat control mapping each game needed (pointer/keys):\n    ${REPORT.farFrames.join('\n    ')}`,
      ].join('\n'),
    );
    expect(REPORT.farFrames.length).toBeGreaterThan(0);
  });
});

describe('no game asks what device it is on', () => {
  /**
   * CLAUDE.md rule 10: "No game code branches on device type. One build serves phone, tablet,
   * laptop, and desktop." `docs/presentation.md` says the same and adds that "there is no API
   * for it, ESLint forbids the globals that would answer" — which was true of bare
   * identifiers and of nothing else. Nothing checked the member forms until now.
   *
   * Comments and string literals are stripped before the scan, and they have to be: a hundred
   * files talk about what is "on the screen", every manifest carries an `orientation` field,
   * and `'shared-screen'` is a string in every one of them. Scanning raw text produced
   * a hit in three quarters of the repository and not one of them was real.
   */
  const packages = readdirSync(GAMES_ROOT).filter((name) => !name.startsWith('.'));

  /**
   * Every `.ts` file under a package's `src`, at any depth.
   *
   * `readdirSync` on `src` alone was the earlier reading and it was one `mkdir` from being
   * worthless: no game keeps its code in a subdirectory today, so nothing was being missed,
   * and the first one to write `src/rules/bot.ts` would have gone unscanned in silence. A
   * rule that stops applying when somebody tidies up is not a rule.
   */
  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...sources(full));
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  function scan(name: string): string[] {
    const dir = join(GAMES_ROOT, name, 'src');
    const files = sources(dir);
    expect(files.length, `${name} has no source to scan`).toBeGreaterThan(0);

    const offences: string[] = [];
    for (const file of files) {
      const source = stripCommentsAndStrings(readFileSync(file, 'utf8'));
      for (const match of source.matchAll(DEVICE_GLOBALS)) {
        const line = source.slice(0, match.index).split('\n').length;
        offences.push(`${file.slice(dir.length + 1)}:${String(line)} ${match[0].trim()}`);
      }
    }
    return offences;
  }

  it('has game packages to scan', () => {
    expect(packages.length).toBeGreaterThanOrEqual(79);
  });

  /**
   * Every package, with no exceptions.
   *
   * The earlier version scanned all but six named ids and only *warned* about those, on the
   * grounds that a file being typed by somebody else should not turn main red. Two things were
   * wrong with that. The six were finished games, so it was six games of coverage given away
   * for nothing. And rule 10 is not a rule a package grows into: a half-written game that
   * reaches for `navigator` is exactly as broken as a finished one that does, and telling
   * whoever is writing it *now* is worth more than telling them at the end.
   */
  for (const name of packages) {
    it(`${name} reads no device global`, () => {
      expect(
        scan(name),
        `${name} branches on the device — ask seatView(seat, presentation, localSeat) instead`,
      ).toEqual([]);
    });
  }

  it('has a built copy of every playable game to have played', () => {
    // The arms import `dist`; this scan reads `src`. If a playable package has no build at
    // all then the arms played nothing and every green tick above it is about nothing, which
    // is worth a failure rather than a note.
    const unbuilt = packages
      .filter((name) => name in LOADERS_FOR_TEST)
      .filter((name) => buildStamp(name) === 0);
    expect(unbuilt, 'run pnpm typecheck (it runs tsc --build) before trusting this file').toEqual(
      [],
    );
  });
});

describe('switching presentation mid-match does not disturb the simulation', () => {
  /**
   * `docs/presentation.md`: "Runtime presentation switching is not implemented... The
   * abstraction above supports it in principle: presentation is passed per frame rather than
   * baked in at `init`, and simulation state is untouched by it. Nothing exercises that path
   * yet, so it is untested rather than known-good."
   *
   * This exercises it. The context here delivers `presentation` through a getter, which is
   * the strongest reading of "passed per frame" the current `GameContext` permits, so a game
   * that re-read it during `update` would see the switch land. None does — every game copies
   * it in `init` — and the switch is therefore a no-op today. That is the *answer*, not a
   * reason to skip the test: it is what makes the switch safe, and it is what would break the
   * day somebody moved a presentation read into the update path.
   *
   * Each driver's liveness is recorded on its own. `isInert(control) && isInert(botControl)`
   * at the end was the earlier guard and it cannot fail while either driver moves: Mini
   * Soccer, King of the Yard, Sea Battle, Ludo, Slot Cars and Dung Battle all had a dead storm
   * carried by a live bot arm, so "the switch did not disturb the storm" was true of nothing
   * for six games and read exactly like a pass. The comparisons still run — a difference
   * between two constant traces is still a difference — but a vacuous driver is named.
   *
   * Driven by {@link SHARED_BOTH_HANDS} rather than by the arm the parity tests use, and the
   * difference is not cosmetic. The parity arm deliberately drives only the seat whose
   * controls the presentation cannot rotate — which is exactly the seat a rotation bug cannot
   * reach. Tic Tac Toe was rewritten to re-read the live presentation inside `#shouldRotate`,
   * the plainest form of this bug there is, and the gated arm did not notice, because the
   * only thing that changed was the *far* seat's board and a bot was sitting in it. The
   * ungated storm on both seats caught it at once. Comparing two runs of the same starting
   * presentation is what makes that legal here: control mapping is identical between them by
   * definition, so any difference at all is the switch being noticed.
   */
  for (const [id, load] of SUBJECTS) {
    it(`${id} is unmoved by the presentation changing under it`, async () => {
      const loaded = await load();

      const control = drive(loaded.manifest, () => loaded.create(), SHARED_BOTH_HANDS);
      const singleControl = drive(loaded.manifest, () => loaded.create(), SINGLE_BOTH_HANDS);
      const botControl = drive(loaded.manifest, () => loaded.create(), SHARED_BOTS);
      if (isInert(control) || isInert(singleControl)) REPORT.deadSwitchArms.push(`${id}/storm`);
      if (isInert(botControl)) REPORT.deadSwitchArms.push(`${id}/bots`);

      // Once, a third of the way in.
      const switched = drive(loaded.manifest, () => loaded.create(), {
        ...SHARED_BOTH_HANDS,
        flipAt: 300,
      });
      expect(switched, `${id} changed when the presentation switched at step 300`).toEqual(control);

      // And from the other side, so a game that happened to start in the presentation it
      // prefers is not the reason this passed.
      const back = drive(loaded.manifest, () => loaded.create(), {
        ...SINGLE_BOTH_HANDS,
        flipAt: 450,
      });
      expect(back, `${id} changed when the presentation switched at step 450`).toEqual(
        singleControl,
      );

      // And once more with two bots and no hands at all. It adds little sensitivity — a bot
      // is indifferent to which way the board faces — but it is the arm that moves for the
      // handful of games a fifteen-second storm never gets a goal past.
      const botSwitched = drive(loaded.manifest, () => loaded.create(), {
        ...SHARED_BOTS,
        flipAt: 300,
      });
      expect(
        botSwitched,
        `${id} changed when the presentation switched under two bots at step 300`,
      ).toEqual(botControl);
    });
  }

  it('says out loud which switch drivers were vacuous, on every run', () => {
    console.warn(
      reportLines('runtime switch: drivers that never moved the game', REPORT.deadSwitchArms),
    );
    expect(REPORT.deadSwitchArms.length).toBeLessThan(SUBJECTS.length);
  });
});

describe('the harness can fail', () => {
  /**
   * A guard nobody has watched fail is not a guard. Everything below is a deliberate defect
   * fed to the same machinery the assertions above use, so this file's silence stays evidence
   * of the repository being right rather than of the harness being asleep.
   */

  /** A game whose *rules* change with the presentation — the defect this file exists to catch. */
  class PresentationBranchingGame implements Game {
    #context: GameContext | null = null;
    #p1 = 0;

    init(context: GameContext): void {
      this.#context = context;
      this.#p1 = 0;
    }

    update(): void {
      // Re-read every step, so it sees a mid-match switch as well as the initial value.
      if (this.#context?.presentation === 'single-seat') this.#p1 += 1;
    }

    render(): void {}
    onPause(): void {}
    onResume(): void {}
    getScore(): MatchScore {
      return { p1: this.#p1, p2: 0, winner: null };
    }
    destroy(): void {}
  }

  const fakeManifest = {
    ...({} as GameManifest),
    id: 'fake',
    logical: { width: 800, height: 1200 },
    zoneSplit: 'horizontal' as const,
  } as GameManifest;

  /**
   * A game whose rules change with the presentation **only on the far seat's human path** —
   * the exact shape the three bot-opposite arms cannot see.
   */
  class FarSeatBranchingGame implements Game {
    #context: GameContext | null = null;
    #p2 = 0;

    init(context: GameContext): void {
      this.#context = context;
      this.#p2 = 0;
    }

    update(_delta: number, input: InputState): void {
      const context = this.#context;
      if (context === null) return;
      // A bot in the seat returns first, which is why every arm with a bot opposite is blind
      // to the line below it.
      if (context.botDifficulty('p2') !== null) return;
      if (context.presentation === 'shared-screen' && input.seat('p2').pointer !== null) {
        this.#p2 += 1;
      }
    }

    render(): void {}
    onPause(): void {}
    onResume(): void {}
    getScore(): MatchScore {
      return { p1: 0, p2: this.#p2, winner: null };
    }
    destroy(): void {}
  }

  it('a rule that only bites the far seat is caught by the far-seat arm', () => {
    // The three arms above it are not: all three put a bot opposite, and a bot branch returns
    // before the seat's input is ever read.
    const create = (): Game => new FarSeatBranchingGame();
    for (const [shared, single] of [
      [SHARED_LOCAL_P1, SINGLE_LOCAL_P1],
      [SHARED_BOTS, SINGLE_BOTS],
    ] as const) {
      expect(drive(fakeManifest, create, single)).toEqual(drive(fakeManifest, create, shared));
    }
    for (const frames of FAR_SEAT_FRAMES) {
      const [sharedArm, singleArm] = farSeatArms(frames);
      expect(
        drive(fakeManifest, create, singleArm),
        `the ${frames.pointer}/${frames.keys} mapping let a far-seat rule difference through`,
      ).not.toEqual(drive(fakeManifest, create, sharedArm));
    }
  });

  it('the far-seat arm reaches the far seat at all', () => {
    // The assertion above would also pass if the arm sent nothing and the fake scored zero in
    // both. It does not: the shared arm has to have counted something.
    const [sharedArm] = farSeatArms(FAR_SEAT_FRAMES[0]!);
    const trace = drive(fakeManifest, () => new FarSeatBranchingGame(), sharedArm);
    expect(trace[trace.length - 1]![1]).toBeGreaterThan(0);
  });

  it('a game that reads the presentation while it plays is caught', () => {
    const a = drive(fakeManifest, () => new PresentationBranchingGame(), SHARED_LOCAL_P1);
    const b = drive(fakeManifest, () => new PresentationBranchingGame(), SINGLE_LOCAL_P1);
    expect(b).not.toEqual(a);
  });

  it('a mid-match switch that the game notices is caught', () => {
    const control = drive(fakeManifest, () => new PresentationBranchingGame(), SHARED_LOCAL_P1);
    const switched = drive(fakeManifest, () => new PresentationBranchingGame(), {
      ...SHARED_LOCAL_P1,
      flipAt: 300,
    });
    expect(switched).not.toEqual(control);
  });

  it('tells two different matches apart', async () => {
    // Same presentation, different opponent. If the signature could not see this, it could
    // not see anything, and every comparison above would be agreement about nothing.
    const loaded = await LOADERS_FOR_TEST['air-hockey']!();
    const easy = drive(loaded.manifest, () => loaded.create(), SHARED_BOTS);
    const hard = drive(loaded.manifest, () => loaded.create(), {
      ...SHARED_BOTS,
      botSeats: ['p2'],
    });
    expect(hard).not.toEqual(easy);
  });

  it('records a full trace rather than comparing two empty ones', async () => {
    const loaded = await LOADERS_FOR_TEST['air-hockey']!();
    expect(drive(loaded.manifest, () => loaded.create(), SHARED_LOCAL_P1)).toHaveLength(STEPS);
  });

  it('counts the randomness the simulation spends', async () => {
    // The draw count is half the signature's strength; if it were stuck at zero the other
    // half would be carrying the whole test without anybody noticing.
    const loaded = await LOADERS_FOR_TEST['whack-a-mole']!();
    const trace = drive(loaded.manifest, () => loaded.create(), SHARED_BOTS);
    expect(trace[trace.length - 1]![4]).toBeGreaterThan(0);
  });

  it('sees a device global that ESLint would miss', () => {
    // `globalThis.navigator.maxTouchPoints` contains no bare restricted identifier, so the
    // lint rule passes it. This is the case that motivated scanning the text.
    const sneaky = stripCommentsAndStrings(
      'const touch = globalThis.navigator.maxTouchPoints > 0;\n',
    );
    expect([...sneaky.matchAll(DEVICE_GLOBALS)].length).toBeGreaterThan(0);
  });

  it('does not see a device global that is only being talked about', () => {
    // The other half: without stripping, three quarters of the repository trips this rule on
    // the word "screen" in a comment and on `'shared-screen'` in a manifest.
    const innocent = stripCommentsAndStrings(
      "// the navigator is not consulted; document nothing\nconst mode = 'shared-screen';\nconst note = `on screen: ${String(1)}`;\n",
    );
    expect([...innocent.matchAll(DEVICE_GLOBALS)]).toEqual([]);
  });

  it('does not eat the file when a regex holds a quote', () => {
    // The failure this guards is silent and unbounded: read as a string opener, the quote
    // inside the pattern swallowed everything up to the next quote — which in a real game is
    // hundreds of lines later, taking every device global with it.
    const source = stripCommentsAndStrings(
      "const bad = /[\"']/.test(name);\nconst dpr = devicePixelRatio;\n",
    );
    expect([...source.matchAll(DEVICE_GLOBALS)].length).toBeGreaterThan(0);
  });

  it('still reads a division as a division', () => {
    // The other half of the regex state: `a / b` must not open a literal and eat the rest of
    // the line, or the fix would have swapped one silent blind spot for another.
    const source = stripCommentsAndStrings('const half = width / 2 + innerWidth;\n');
    expect([...source.matchAll(DEVICE_GLOBALS)].length).toBeGreaterThan(0);
  });

  it('keeps an expression inside a template literal', () => {
    // Stripping must not swallow code. A device read hidden in an interpolation is still a
    // device read, and this is the case a naive "delete everything in backticks" would lose.
    const hidden = stripCommentsAndStrings('const s = `dpr ${String(devicePixelRatio)}`;\n');
    expect([...hidden.matchAll(DEVICE_GLOBALS)].length).toBeGreaterThan(0);
  });

  it('the settle gate is not what decides the answer', async () => {
    // The 40-step gate exists to clear the board flip, and a knob like that earns its keep
    // only if the result does not depend on where it is set. Every turn-based game is played
    // again at double the gate; the set of games that diverge must not change.
    for (const [id, load] of SUBJECTS) {
      const loaded = await load();
      if (!loaded.manifest.archetype.startsWith('turn-')) continue;
      const wide = { settleGuard: SETTLE_GUARD * 2 };
      const shared = drive(loaded.manifest, () => loaded.create(), {
        ...SHARED_LOCAL_P1,
        ...wide,
      });
      const single = drive(loaded.manifest, () => loaded.create(), {
        ...SINGLE_LOCAL_P1,
        ...wide,
      });
      const diverged = JSON.stringify(shared) !== JSON.stringify(single);
      expect(
        diverged,
        `${id} answers differently at a ${String(SETTLE_GUARD * 2)}-step gate than at a ${String(SETTLE_GUARD)}-step one — the gate, not the game, is deciding`,
      ).toBe(expectedToDiverge(id, 'human'));
    }
  }, 120_000);
});

/**
 * True when a `/` at this point in the output can only be starting a regular expression.
 *
 * The last token decides it, and the rule is the usual one: a `/` after something that can
 * *end* an expression is division, and after anything else it opens a literal. Conservative on
 * purpose — `)` is called division here, so `if (x) /re/.test(s)` is read as division and its
 * body is left in the text. Guessing wrong that way costs a possible false positive, which is
 * loud; guessing wrong the other way swallows real code, which is silent.
 */
function opensRegex(out: string): boolean {
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const character = out[i]!;
    if (character === ' ' || character === '\t' || character === '\n' || character === '\r') {
      continue;
    }
    return !/[\w$)\]}]/.test(character);
  }
  return true;
}

/**
 * Blank out comments, string bodies and regex bodies, keeping template interpolations.
 *
 * Deliberately not a regex. The interpolation case is the one that matters — a device read
 * inside `${...}` is a device read — and no single regex both drops a backtick string and
 * keeps the code inside it. Everything else is line comments, block comments, the two quote
 * characters and regex literals, which a left-to-right walk handles exactly.
 *
 * **Regex literals have to be one of the states.** Without them a line containing a pattern
 * with a quote in it — `/["']/`, which nothing in the collection writes today and any game
 * validating a name might — read as the start of a string literal, and the walk ran on to the
 * next matching quote hundreds of lines later, blanking every device global in between. That
 * is the one failure mode a scanner like this must not have: it fails *open*, silently, and
 * the more code it eats the greener it looks. Both scanners are also bounded to a single line
 * now, because neither a string literal nor a regex literal may contain a raw newline, so the
 * worst a misreading can cost is the rest of one line rather than the rest of the file.
 */
export function stripCommentsAndStrings(source: string): string {
  let out = '';
  let index = 0;
  let templateDepth = 0;
  const length = source.length;

  while (index < length) {
    const here = source[index];
    const next = source[index + 1];

    if (templateDepth === 0) {
      if (here === '/' && next === '/') {
        while (index < length && source[index] !== '\n') index += 1;
        continue;
      }
      if (here === '/' && next === '*') {
        index += 2;
        while (index < length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
        index += 2;
        continue;
      }
      if (here === "'" || here === '"') {
        const quote = here;
        index += 1;
        while (index < length && source[index] !== quote && source[index] !== '\n') {
          if (source[index] === '\\') index += 1;
          index += 1;
        }
        index += 1;
        // A blank pair, so `'shared-screen'` leaves a token behind rather than joining its
        // neighbours into a word that was never written.
        out += '""';
        continue;
      }
      if (here === '/' && opensRegex(out)) {
        index += 1;
        let inClass = false;
        while (index < length && source[index] !== '\n') {
          const character = source[index]!;
          if (character === '\\') {
            index += 2;
            continue;
          }
          if (character === '[') inClass = true;
          else if (character === ']') inClass = false;
          else if (character === '/' && !inClass) {
            index += 1;
            break;
          }
          index += 1;
        }
        while (index < length && /[a-z]/.test(source[index]!)) index += 1;
        // Same reasoning as the blank quote pair: leave a token, join nothing.
        out += '""';
        continue;
      }
      if (here === '`') {
        templateDepth += 1;
        index += 1;
        continue;
      }
      out += here;
      index += 1;
      continue;
    }

    if (here === '\\') {
      index += 2;
      continue;
    }
    if (here === '`') {
      templateDepth -= 1;
      index += 1;
      continue;
    }
    if (here === '$' && next === '{') {
      index += 2;
      let braces = 1;
      let expression = '';
      while (index < length) {
        const character = source[index]!;
        if (character === '{') braces += 1;
        else if (character === '}') {
          braces -= 1;
          if (braces === 0) break;
        }
        expression += character;
        index += 1;
      }
      index += 1;
      out += ` ${expression} `;
      continue;
    }
    index += 1;
  }

  return out;
}
