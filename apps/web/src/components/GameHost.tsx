'use client';

import { useEffect, useRef } from 'react';
import {
  Canvas2DRenderer,
  FixedLoop,
  InputManager,
  InputRecorder,
  InputView,
  Rng,
  exportTrace,
  RunLoop,
  browserClock,
  clampDevicePixelRatio,
  negotiateSharedLogical,
  negotiateSharedViewport,
  NO_INSETS,
  viewportToLogical,
  vec2,
  zoneSplitFor,
  type Presentation,
  type LogicalSize,
  type SeatId,
  type ZoneSplit,
} from '@duelbox/engine';
import {
  guard,
  createPresentationToggle,
  isSimulating,
  type Game,
  type GameContext,
  type GameManifest,
  type MatchPhase,
} from '@duelbox/game-sdk';
import { readBindings } from '@/lib/key-bindings';
import { audio } from '@/lib/audio';
import { prefersReducedMotion } from '@/lib/reduced-motion';
import { readSettings } from '@/lib/settings';
import styles from './GameHost.module.css';

/**
 * Runs one game on a canvas.
 *
 * Everything wall-clock, device and DOM lives here so games never touch any of it: the
 * host owns the canvas, the resize observer, the pointer and key listeners, the fixed
 * loop and the renderer. A game receives a fixed delta and a normalised input state, and
 * draws in logical units.
 *
 * The host does not decide when a match is running — it is told, through `phase`. That
 * keeps one answer to "is the simulation moving" (the match machine's) rather than two
 * that can disagree.
 */

export interface GameHostProps {
  manifest: GameManifest;
  createGame: () => Game;
  seed: number;
  /** The match machine's current phase. The host steps the game only while playing. */
  phase: MatchPhase;
  /** Which seat this device plays. Only meaningful in single-seat presentation. */
  localSeat?: SeatId;
  presentation?: 'shared-screen' | 'single-seat';
  /**
   * The logical play area the *other* device declared, for a remote match (#1862).
   *
   * At match start the host negotiates one shared logical viewport both devices letterbox to,
   * so neither player ever sees more of the play area than the other (CLAUDE.md rule 9). For
   * a matched pair this equals the game's own box and the negotiation returns it unchanged;
   * the point is that the box both devices draw is *agreed*, not assumed per screen. Omitted
   * for local play, where there is no second device and the game's box is the shared box.
   */
  peerLogical?: LogicalSize;
  /** Which seat moves first this round. The match machine decides it; the host relays it. */
  openingSeat?: SeatId;
  botDifficulty?: Partial<Record<SeatId, 'easy' | 'normal' | 'hard'>>;
  /**
   * One fixed simulation step elapsed. Fires in every running phase, including the
   * countdown, so the shell's clock advances on the same timestep as the physics rather
   * than on a separate wall-clock timer that two devices would disagree about.
   */
  onTick?: (fixedDeltaSeconds: number) => void;
  onScore?: (p1: number, p2: number, winner: SeatId | 'draw' | null) => void;
  onActiveSeat?: (seat: SeatId | null) => void;
  /** The window went away. The shell decides what that means; the host never pauses itself. */
  onRequestPause?: () => void;
  /**
   * The match cannot go on, and the shell has to say so.
   *
   * Two things arrive here and they are not the same failure. A throw escaping the game's
   * `update()` or `render()` (#151) is the first: a React error boundary cannot catch it,
   * because it happens in a `requestAnimationFrame` callback outside React, so the host
   * catches it, stops the loop, and reports it. The second is a drawing surface this
   * device has proved it cannot keep (#101) — nothing threw, but there is nowhere left to
   * draw, and a match that keeps stepping into a canvas the browser has taken away is a
   * blank rectangle with a simulation behind it.
   *
   * Both end the same way and so both come through one prop: the shell raises the one
   * recovery screen, which offers Restart — remounting this host and asking the browser
   * for a fresh context — or Quit. The host never decides on its own that a match is over.
   */
  onError?: (error: unknown) => void;
  /**
   * Record every input event, for export as a replayable trace.
   *
   * Off unless asked for. Recording costs an array push per event and nothing else, but a
   * match nobody is debugging should not accumulate one — and a feature that is always on is
   * a feature nobody can rule out when something goes wrong.
   */
  recordTrace?: boolean;
  /**
   * Handed a function that returns the trace so far, as JSON, whenever recording is on.
   *
   * A getter rather than the trace itself: the trace grows every frame, and passing the value
   * up would either re-render the shell sixty times a second or hand it something stale.
   */
  onTraceReady?: (getTrace: () => string) => void;
}

/**
 * The split the shell puts the pointer surface on, for a manifest, a presentation and whoever
 * currently has the move — delegated to the engine so the shell owns no second copy of the rule.
 *
 * A game with turns owns the whole pointer surface; only a real-time game on a shared screen
 * has zones, and a single-seat player owns the whole viewport whatever the manifest says. The
 * rule lives in {@link zoneSplitFor} because the input fuzzer has to reach the identical answer
 * — it had its own copy, and for eleven real-time games the two copies disagreed (#2479).
 * Exported so that agreement can be asserted rather than assumed (`data/input-fuzz.test.ts`).
 */
export function hostZoneSplit(
  manifest: GameManifest,
  presentation: Presentation,
  activeSeat: SeatId | null,
): ZoneSplit {
  return zoneSplitFor(presentation, manifest.zoneSplit, activeSeat);
}

export function GameHost({
  manifest,
  createGame,
  seed,
  phase,
  localSeat = 'p1',
  presentation = 'shared-screen',
  openingSeat = 'p1',
  peerLogical,
  botDifficulty,
  onTick,
  onScore,
  onActiveSeat,
  onRequestPause,
  onError,
  recordTrace = false,
  onTraceReady,
}: GameHostProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runnerRef = useRef<RunLoop | null>(null);
  const loopRef = useRef<FixedLoop | null>(null);
  const gameRef = useRef<Game | null>(null);

  // Callbacks and phase are read through refs so changing any of them never re-runs the
  // setup effect: doing so would tear down the canvas and restart the match mid-play.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const onScoreRef = useRef(onScore);
  onScoreRef.current = onScore;
  const onActiveSeatRef = useRef(onActiveSeat);
  onActiveSeatRef.current = onActiveSeat;
  const onRequestPauseRef = useRef(onRequestPause);
  onRequestPauseRef.current = onRequestPause;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onTraceReadyRef = useRef(onTraceReady);
  onTraceReadyRef.current = onTraceReady;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    // The one play area both players share, negotiated once before the first frame (rule 9,
    // #1862). `negotiateSharedLogical` — which had no non-test caller until now — decides the
    // box by agreement between the two devices' declarations rather than letting each device
    // letterbox its own screen independently. For a matched pair (both on the same game) it
    // is the game's own box; a mismatch is clamped so neither device shows a strip of world
    // the other cannot, the same disagreement LockstepSession refuses. Everything below draws
    // and hit-tests in this box; the simulation runs in `manifest.logical`, and the two are
    // equal for any pair the shell would actually start.
    const peerBox = peerLogical ?? manifest.logical;
    const logical = negotiateSharedLogical(manifest.logical, peerBox);
    const renderer = new Canvas2DRenderer(context, logical);
    // Reduced motion is a device preference, so it is read here and nowhere else: no
    // game code may branch on the device (CLAUDE.md rule 10). The flip still *steps*
    // identically on every device — only what is drawn changes — or two devices would
    // disagree about when input reopens.
    // Safe to reach for unguarded: effects only run in the browser.
    const motion = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
    renderer.setReducedMotion(motion.matches);
    function onMotionChange(event: MediaQueryListEvent): void {
      renderer.setReducedMotion(event.matches);
    }
    motion.addEventListener('change', onMotionChange);
    const inputView = new InputView();
    const game = createGame();
    /**
     * A game with turns owns the whole pointer surface; only a real-time game has zones.
     *
     * This was a serious bug, and it hid behind a test that aimed only where it worked.
     * A turn-based board **rotates to face whoever is to move**, so its far side sits in
     * the other seat's zone — and every tap aimed there was attributed to a player whose
     * turn it was not, and dropped. In Tic Tac Toe the far row of cells could not be
     * reached by touch at all. Ten shared-board games had the same hole.
     *
     * `getActiveSeat` is the honest discriminator rather than the manifest's `zoneSplit`:
     * Whack a Mole is a shared board too, but both seats swing at it at once, so it needs
     * its zones exactly as much as Tic Tac Toe needed to lose them.
     */
    // Read from the *live* value rather than from whether the method exists. The contract
    // has always said returning null means "no turns right now", and a game can mean it
    // for part of its life: Sea Battle has both players lay out their fleets at the same
    // time, each on their own half, and only then starts taking turns at a shared grid.
    //
    // The rule itself lives in the engine, in {@link zoneSplitFor}, because the input fuzzer
    // has to reach the identical answer — it had its own copy, and for eleven real-time games
    // the two copies disagreed (#2479). The shell delegates rather than deriving, so there is
    // one rule; `data/input-fuzz.test.ts` asserts the shell owns no second copy.
    const splitFor = (seat: SeatId | null): ZoneSplit =>
      hostZoneSplit(manifest, presentation, seat);

    const initialSeat = game.getActiveSeat?.() ?? null;
    const manager = new InputManager(logical, {
      split: splitFor(initialSeat),
      bottomSeat: initialSeat ?? localSeat,
      // #129, #2428, and the reason the settings page's Keys section is not decoration.
      // `lib/key-bindings.ts` had the store, the defaults, the reserved list and the
      // conflict rules, with a test file beside them, and **nothing imported it** — this
      // line is the only place a chosen binding can reach a match, and without it a player
      // could rebind their keys and watch the old ones keep working.
      //
      // Read here rather than held in React state on purpose: bindings are read once when
      // the match is built, so a change made in another tab cannot alter the controls
      // underneath a running match. `readBindings` falls all the way back to the defaults
      // for anything missing, malformed, reserved or conflicting, so this cannot hand the
      // manager a keyboard a player is stuck with.
      bindings: readBindings(),
    });
    // The recorder has the same surface as the manager, so every call site below is unchanged
    // whether or not anybody is recording — which is the only way a recording is worth having,
    // since a separate code path would not be the path the bug was on.
    const recorder = recordTrace ? new InputRecorder(manager) : null;
    const input: InputManager | InputRecorder = recorder ?? manager;

    gameRef.current = game;
    // The presentation is read through a getter over this mutable, not baked in, so it can be
    // flipped live by the dev toggle below without rebuilding the match (#1863). Switching it
    // mid-match cannot disturb the simulation — presentation-parity.test.ts proves every game
    // steps the identical trace across a switch — so this is safe; it only changes what is
    // drawn. In production the toggle is stripped, so `livePresentation` never changes and this
    // is exactly the fixed prop it used to be.
    let livePresentation = presentation;
    const gameContext: GameContext = {
      manifest,
      rng: new Rng(seed),
      get presentation() {
        return livePresentation;
      },
      localSeat,
      openingSeat,
      // Read here rather than through the hook, and the difference matters: a game is
      // handed its context once, inside this effect, and cannot be told again. A hook's
      // state is still `false` on the render that schedules this effect, so a player who
      // asked their system for reduced motion would get a full-motion match and only the
      // next one would honour it. The direct read answers before the game exists (#175).
      reducedMotion: prefersReducedMotion(),
      botDifficulty: (seat) => botDifficulty?.[seat] ?? null,
    };
    game.init(gameContext);

    // NO_INSETS, deliberately. Safe-area handling belongs to the layout, which pads the
    // shell so this canvas is already inside the safe region by the time it is measured.
    // Subtracting the root insets here as well shrank the play area twice over on a
    // notched phone, and cost a getComputedStyle on every resize to do it.
    // Letterbox this device to the negotiated shared box. `negotiateSharedViewport` is the
    // match-path seam: it re-affirms the shared box (idempotent — `logical` is already it) and
    // fits this screen to it, so a wider or taller screen gets bars rather than more world.
    let view = negotiateSharedViewport(
      {
        logical,
        screenWidth: canvas.clientWidth,
        screenHeight: canvas.clientHeight,
        insets: NO_INSETS,
      },
      peerBox,
    ).view;
    const scratch = vec2();
    let lastWidth = -1;
    let lastHeight = -1;
    let lastDpr = -1;
    let resizeHandle = 0;

    // The element is passed in rather than closed over: TypeScript will not carry the
    // null-narrowing of a ref into a hoisted function declaration.
    function resize(el: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
      const dpr = clampDevicePixelRatio(globalThis.devicePixelRatio);
      const cssWidth = el.clientWidth;
      const cssHeight = el.clientHeight;
      // Reassigning canvas.width clears the backing store and forces a reallocation, so
      // a resize that is not a resize must not reach it. Mobile browser chrome sliding
      // in and out fires the observer repeatedly at the same size.
      if (cssWidth === lastWidth && cssHeight === lastHeight && dpr === lastDpr) return;
      lastWidth = cssWidth;
      lastHeight = cssHeight;
      lastDpr = dpr;
      el.width = Math.round(cssWidth * dpr);
      el.height = Math.round(cssHeight * dpr);
      // Draw in CSS pixels; the backing store carries the device ratio.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      view = negotiateSharedViewport(
        { logical, screenWidth: cssWidth, screenHeight: cssHeight, insets: NO_INSETS },
        peerBox,
      ).view;
      renderer.setViewport(view);
    }
    resize(canvas, context);

    // Coalesced into one animation frame. The observer can fire several times for a
    // single chrome transition, and reallocating the backing store on each is the layout
    // thrash the player sees as a stutter mid-match.
    const observer = new ResizeObserver(() => {
      if (resizeHandle !== 0) return;
      resizeHandle = globalThis.requestAnimationFrame(() => {
        resizeHandle = 0;
        resize(canvas, context);
      });
    });
    observer.observe(canvas);

    const el = canvas;

    /** Screen coordinates reach the game in logical units, never device pixels. */
    function toLogical(event: PointerEvent): { x: number; y: number } {
      const rect = el.getBoundingClientRect();
      viewportToLogical(scratch, event.clientX - rect.left, event.clientY - rect.top, view);
      return scratch;
    }

    function onPointerDown(event: PointerEvent): void {
      // A touch that lands while the board is frozen must not be queued up and fired the
      // instant play resumes.
      if (!isSimulating(phaseRef.current)) return;
      el.setPointerCapture(event.pointerId);
      const point = toLogical(event);
      input.pointerDown(event.pointerId, point.x, point.y);
    }
    function onPointerMove(event: PointerEvent): void {
      if (!isSimulating(phaseRef.current)) return;
      const point = toLogical(event);
      input.pointerMove(event.pointerId, point.x, point.y);
    }
    function onPointerUp(event: PointerEvent): void {
      input.pointerUp(event.pointerId);
    }
    /**
     * A cancellation is not a release, and must never be delivered as one.
     *
     * `pointercancel` is the browser saying the gesture *did not happen* — a system
     * edge-swipe, palm rejection, an incoming call, the pointer being taken away. Wired
     * to `onPointerUp`, as it was until #2480, it produced an ordinary `actionReleased`,
     * so a player who started to aim and got a system gesture did not get their aim
     * cancelled: they got a shot they never took, at whatever the aim happened to be. On
     * a phone, where an edge swipe is how you leave an app, that is not an edge case.
     */
    function onPointerCancel(event: PointerEvent): void {
      input.pointerCancel(event.pointerId);
    }
    function onKeyDown(event: KeyboardEvent): void {
      // Escape belongs to the shell's pause menu, so it is never swallowed here.
      if (event.code === 'Escape') return;
      // A held modifier means the player is talking to the browser or the OS, not to
      // the game: Cmd+W closes the tab, Ctrl+R reloads, Alt+Tab switches window. Two
      // reasons to let those through untouched. Swallowing them traps the player in the
      // page, and on macOS a letter pressed with Command held never delivers its keyup
      // at all — so treating it as gameplay leaves that key stuck down for the rest of
      // the match.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!isSimulating(phaseRef.current)) return;
      input.keyDown(event.code);
      // A bound key belongs to the game while a match is live, whatever the browser has
      // focused. Otherwise seat two's Enter activates the focused button instead of
      // playing — a player pressing their own action key opened the pause menu. Escape
      // returns above and is never captured, so the way out is always available; and
      // once paused the phase is no longer live, so every control works normally again.
      if (SCROLL_KEYS.has(event.code) || input.isBound(event.code)) event.preventDefault();
    }
    function onKeyUp(event: KeyboardEvent): void {
      input.keyUp(event.code);
    }
    function onModifierRelease(event: KeyboardEvent): void {
      // Safety net for the keyup that never arrives. If a modifier is released and the
      // player was mid-chord, anything still held is cleared rather than left down.
      if (event.key === 'Meta' || event.key === 'Control' || event.key === 'Alt') input.clear();
    }
    function onContextMenu(event: Event): void {
      // A long press is a legitimate game input; on touch it otherwise raises the
      // callout menu and the press is lost. CSS cannot suppress this on Android.
      event.preventDefault();
    }
    function onBlur(): void {
      // Otherwise a player returns to a stuck direction.
      input.clear();
      onRequestPauseRef.current?.();
    }

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('contextmenu', onContextMenu);
    globalThis.addEventListener('keydown', onKeyDown);
    globalThis.addEventListener('keyup', onKeyUp);
    globalThis.addEventListener('keyup', onModifierRelease);
    globalThis.addEventListener('blur', onBlur);

    let lastP1 = -1;
    let lastP2 = -1;
    /**
     * The winner reported last, so the end of a match is never missed.
     *
     * Watching only the two score numbers was a real bug: a match can end on a step that
     * changes neither. Road Dodge is the plain case — a crash decides it and nobody's
     * count moves — and the match simply never ended, the result screen never appeared,
     * and the game sat frozen behind a live pause button. Any game whose win condition is
     * survival rather than points would have hit exactly this.
     */
    let lastWinner: SeatId | 'draw' | null = null;
    let lastSeat: SeatId | null | undefined;

    /**
     * The three bindings the debug overlay of #119 needs, and the only three lines of it
     * that are not already inside a branch a bundler deletes.
     *
     * They survive webpack — a `let` is not a dead branch — and then go, because once every
     * `if (process.env.NODE_ENV !== 'production')` below has been folded away nothing reads
     * or writes them and the minifier drops them as unused. Put through this project's own
     * webpack and its own minifier, this shape emits bytes identical to the same code
     * written with no debug lines in it at all.
     */
    let debugFrames = 0;
    let debugCancelled = false;
    let stopDebugOverlay: (() => void) | undefined;
    // Same shape and same fate as the debug bindings above: a `let` that survives the bundler
    // and then goes, because once the production build folds `process.env.NODE_ENV !==
    // 'production'` to `false` nothing writes it and the minifier drops it. It carries the
    // dev-only presentation toggle's teardown (#1863).
    let stopPresentationToggle: (() => void) | undefined;

    /**
     * A throw escaped game code (#151). Stop the loop and report it once.
     *
     * A React error boundary cannot reach a throw in these `requestAnimationFrame` callbacks,
     * so the guard below catches it here and this is what it does with it: stop stepping the
     * broken game — one more step would just throw again — and hand the error to the shell,
     * which raises the recovery UI. `crashed` latches so a second callback in the same frame,
     * or anything the stop has not torn down yet, does not report twice.
     */
    let crashed = false;
    function onGameError(error: unknown): void {
      if (crashed) return;
      crashed = true;
      runnerRef.current?.stop();
      onErrorRef.current?.(error);
    }

    /**
     * The drawing surface can be taken away, and unhandled that is the blank rectangle
     * #101 is about.
     *
     * The issue says WebGL. There is none in this repository — every game draws through
     * `Canvas2DRenderer` and the only `getContext` on this page asks for `'2d'` — but a 2D
     * context is lost under the same memory pressure and fires the same pair of events
     * under the names `contextlost` and `contextrestored`. Nothing listened for either,
     * so a phone that reclaimed this canvas mid-match left both players looking at an
     * empty box with the simulation still running behind it, and the only clue was that
     * nothing moved.
     *
     * Two responses, and neither of them is a screen this component draws for itself. A
     * loss the renderer still expects to recover from is the same event as the window
     * going away: clear whatever was held down and ask the shell to pause, which is where
     * every other "not right now" already goes. A surface the renderer has given up on is
     * the same event as a game that threw: the match is over and the shell's one recovery
     * screen offers Restart or Quit. A third screen inside the host would be the bespoke
     * copy of a shell feature CLAUDE.md calls a bug, and it would ship on the play route
     * to say what two existing screens already say.
     */
    const stopSurfaceWatch = renderer.watchSurface(
      canvas,
      (abandoned) => {
        if (abandoned) {
          onGameError(new Error('The drawing surface was lost twice, so the match stopped.'));
          return;
        }
        // Exactly what `onBlur` does and for its reason: a key or a finger held when the
        // surface went must not still be held when it comes back.
        input.clear();
        onRequestPauseRef.current?.();
      },
      () => {
        // Everything the *context* held went with the surface, the device-pixel-ratio
        // transform included, and `resize` returns early unless a measurement changed —
        // which after a restore it has not. Without this line the canvas comes back and
        // every frame after it draws at 1/dpr into the corner of a full-size backing
        // store. The renderer's own viewport needs nothing: `beginFrame` re-applies the
        // scale and letterbox offset on every frame rather than leaving them on the
        // context, so the first frame back sets them itself.
        lastWidth = -1;
        resize(canvas, context);
      },
    );

    const loop = new FixedLoop({
      update(dt) {
        if (crashed) return;
        // Never step into a canvas nobody can see (#101). The renderer is the one answer
        // to whether there is anywhere to draw, so this host keeps no second copy of it
        // that could disagree. A getter over a boolean, so the step path allocates
        // nothing for it (rule 5).
        if (renderer.surfaceLost) return;
        // The shell's clock runs in every live phase; the simulation only while playing.
        onTickRef.current?.(dt);
        if (!isSimulating(phaseRef.current)) {
          // Input still has to be drained, or a key held through a countdown arrives as
          // a fresh press on the first simulated step.
          input.beginStep(dt);
          return;
        }
        // Guarded, so a throw from the game becomes the recovery screen rather than a frozen
        // board. Everything the step reads off the game — score, active seat — is inside the
        // guard too, so a game that throws from `getScore` is caught the same way.
        guard(() => {
          game.update(dt, inputView.sync(input.beginStep(dt)));
          const score = game.getScore();
          if (score.p1 !== lastP1 || score.p2 !== lastP2 || score.winner !== lastWinner) {
            lastP1 = score.p1;
            lastP2 = score.p2;
            lastWinner = score.winner;
            onScoreRef.current?.(score.p1, score.p2, score.winner);
          }
          const seat = game.getActiveSeat?.() ?? null;
          if (seat !== lastSeat) {
            lastSeat = seat;
            // The board changed hands, so the pointer surface does too — and a game that
            // goes back to having no turns gets its two zones back.
            input.setSplit(splitFor(seat));
            input.setBoardSeat(seat ?? localSeat);
            onActiveSeatRef.current?.(seat);
          }
        }, onGameError);
      },
      render(alpha) {
        if (crashed) return;
        // Nothing drawn now would reach a screen, and the frame would cost a full render
        // to be thrown away. The renderer would swallow it safely either way; this is the
        // saving, not the safety.
        if (renderer.surfaceLost) return;
        // The only thing the overlay adds to the hot path, and the one number it cannot get
        // by reading the loop: `FixedLoop` counts steps, and nothing counts frames.
        if (process.env.NODE_ENV !== 'production') debugFrames += 1;
        guard(() => {
          renderer.beginFrame();
          game.render(renderer, alpha);
          renderer.endFrame();
        }, onGameError);
        // Queued sounds reach the graph once a frame, outside the fixed step, so playing a
        // sound from inside `update()` stays allocation-free (rule 5).
        audio().flush();
      },
    });
    loopRef.current = loop;

    if (recorder !== null) {
      onTraceReadyRef.current?.(() =>
        exportTrace(recorder.toTrace(manifest.id, seed, loop.stepSeconds)),
      );
    }

    const runner = new RunLoop(loop, browserClock());
    // Assist-mode speed (#179), read once at match start. It scales wall-clock time into the
    // loop, never the step, so the simulation this match runs is identical to full speed and
    // only slower to watch and to react to. Read directly rather than through the hook for
    // the same reason `reducedMotion` is: the match is built inside this effect and a hook's
    // first value would be the default. The settings-page slider is a different route, so a
    // change takes effect on the next match, which is when this effect runs again.
    runner.setTimeScale(readSettings().gameSpeed);
    runnerRef.current = runner;

    // A host rebuilt mid-match must come back running if the phase says it should be.
    // The phase effect below only fires when the phase *changes*, so a host recreated
    // while the phase stayed the same would be left stopped for good — the match would
    // hang wherever it was, with no error and nothing in the console.
    if (phaseRef.current === 'countdown' || phaseRef.current === 'playing') runner.start();

    /**
     * The debug overlay (#119), switched on with `?debug=1` and absent from production.
     *
     * The gate is the trace panel's: a query parameter, so somebody looking at a stutter can
     * turn it on where the stutter is. The *delivery* is deliberately not the trace panel's.
     * `TracePanel` is a component the play surface renders behind a flag — right for a tool
     * a player has to be able to reach on the deployed site, and wrong here, because a
     * component behind a prop still ships and only its rendering is skipped. The acceptance
     * criterion for this one is zero bytes.
     *
     * So every part of it lives inside this test. `process.env.NODE_ENV` is a string literal
     * by the time webpack parses this file, so the branch folds to `if (false)` and is
     * deleted *before* the `import()` inside it is resolved: no chunk is emitted and
     * `debug/DebugOverlay` is never compiled. That is also why the query parameter is read
     * here rather than in `PlaySurface` and handed down — a prop is a value that has to
     * exist in production for the sake of the branch that ignores it, and a `?debug=1` the
     * shell reads and passes to nobody is the same bytes by another name.
     *
     * Read in an effect, like every other reader of `location` in this app: the play page is
     * statically exported, and reading the URL during a render makes the server's HTML and
     * the browser's first paint disagree.
     */
    if (process.env.NODE_ENV !== 'production') {
      if (new URLSearchParams(globalThis.location.search).get('debug') === '1') {
        void import('./debug/DebugOverlay')
          .then(({ mountDebugOverlay }) => {
            // Strict mode mounts, unmounts and remounts every effect in development, which
            // is exactly where this code runs. Without the flag the discarded host's
            // overlay outlives it and two boxes stack up in the corner.
            if (debugCancelled) return;
            stopDebugOverlay = mountDebugOverlay(() => ({
              at: performance.now(),
              frames: debugFrames,
              steps: loop.totalSteps,
              stepMs: loop.stepSeconds * 1000,
              running: runner.running,
              // The seat ids are written out rather than taken from the engine's `SEATS`,
              // because an import at the top of this file ships whether or not this branch
              // does. `localSeat` above defaults the same way for the same reason.
              seats: (['p1', 'p2'] as const).map((seat) => {
                const view = inputView.seat(seat);
                const pointer = view.pointer;
                return {
                  seat,
                  moveX: view.move.x,
                  moveY: view.move.y,
                  actionHeld: view.actionHeld,
                  holdSeconds: view.holdSeconds,
                  // Copied rather than passed on: the view's vectors are reused every step
                  // so that reading input allocates nothing, and a reading kept across
                  // samples would quietly become a reading of the present.
                  pointer: pointer === null ? null : { x: pointer.x, y: pointer.y },
                  pointerCount: view.pointerCount ?? 0,
                };
              }),
            }));
          })
          .catch(() => {
            // A development tool that will not load is not a reason to take the match down.
          });
      }
    }

    /**
     * A development-only presentation toggle (#1863). Press F2 to flip the active presentation
     * live and see a game's two layouts on one screen without a second device.
     *
     * Stripped from production by the same build-time flag as the debug overlay: webpack folds
     * `process.env.NODE_ENV !== 'production'` to `false` and deletes the block, so no toggle,
     * no key listener and no flip reach a player. The flip only changes what is drawn — the
     * context reads `livePresentation` through a getter and presentation-parity proves a
     * mid-match switch never disturbs the simulation — so it is safe to leave in dev.
     */
    if (process.env.NODE_ENV !== 'production') {
      const toggle = createPresentationToggle(livePresentation, true);
      const onPresentationKey = (event: KeyboardEvent): void => {
        if (event.code !== 'F2') return;
        event.preventDefault();
        livePresentation = toggle.toggle();
      };
      globalThis.addEventListener('keydown', onPresentationKey);
      stopPresentationToggle = () => globalThis.removeEventListener('keydown', onPresentationKey);
    }

    function onVisibility(): void {
      // Tab-switching must not fast-forward the accumulator, and a hidden match must not
      // keep burning battery. The shell is told; it owns the decision.
      if (document.hidden) onRequestPauseRef.current?.();
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      runner.stop();
      if (process.env.NODE_ENV !== 'production') {
        debugCancelled = true;
        stopDebugOverlay?.();
        stopPresentationToggle?.();
      }
      if (resizeHandle !== 0) globalThis.cancelAnimationFrame(resizeHandle);
      runnerRef.current = null;
      loopRef.current = null;
      gameRef.current = null;
      observer.disconnect();
      stopSurfaceWatch();
      motion.removeEventListener('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibility);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('contextmenu', onContextMenu);
      globalThis.removeEventListener('keydown', onKeyDown);
      globalThis.removeEventListener('keyup', onKeyUp);
      globalThis.removeEventListener('keyup', onModifierRelease);
      globalThis.removeEventListener('blur', onBlur);
      game.destroy();
    };
    // `recordTrace` is a real dependency rather than a ref, unlike every other prop here.
    //
    // A recorder can only be installed when the manager is built, so turning recording on has
    // to rebuild the host — and reading it through a ref meant it was read once at mount, before
    // the query parameter had been resolved in an effect, so the recorder was never made at all
    // and the trace stayed empty. Rebuilding costs nothing where it actually happens: recording
    // is decided on the lobby screen, before there is a match to lose.
  }, [
    manifest,
    createGame,
    seed,
    localSeat,
    presentation,
    openingSeat,
    peerLogical,
    botDifficulty,
    recordTrace,
  ]);

  // Start and stop with the phase. Separate from setup so pausing never rebuilds the game.
  useEffect(() => {
    const runner = runnerRef.current;
    const game = gameRef.current;
    if (!runner || !game) return;
    const live = phase === 'countdown' || phase === 'playing';
    if (live) {
      // Take focus so the action keys reach the board rather than a leftover button.
      // `preventScroll` because focusing must never move the page under a live match.
      canvasRef.current?.focus({ preventScroll: true });
      // The time spent paused is not owed to the simulation; without this the first
      // frame back would try to catch it all up at once.
      loopRef.current?.reset();
      game.onResume();
      runner.start();
    } else {
      runner.stop();
      game.onPause();
    }
  }, [phase]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      /* The name was here and nothing was obliged to read it out. `canvas` maps to no ARIA
         role of its own, and an element with no role is an element whose `aria-label` an
         engine is free to drop — so the one thing on this page that is the game announced
         itself as nothing at all, inconsistently, depending on who was listening.
         `role="img"` is what makes the name a name: a picture with a text alternative,
         which is honestly what a board a screen reader cannot enter is. Deliberately not
         `role="application"`, which would hand this element the assistive technology's own
         key handling in exchange for an interface we do not offer. */
      role="img"
      aria-label={`${manifest.name} board`}
      /* Focusable so the board can hold focus during play. Without this, focus sits on
         whichever button was last used and seat two's action key — Enter — activates it
         instead of playing: pressing it opened the pause menu rather than taking a turn.
         Seat one's Space was already safe only because the host suppresses its default
         to stop the page scrolling, which is luck rather than design. */
      tabIndex={0}
    />
  );
}

/** Arrow keys and space scroll the page by default, which ruins a game. */
const SCROLL_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'PageUp',
  'PageDown',
]);
