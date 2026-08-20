'use client';

import { useEffect, useRef } from 'react';
import {
  Canvas2DRenderer,
  FixedLoop,
  InputManager,
  InputView,
  Rng,
  RunLoop,
  browserClock,
  clampDevicePixelRatio,
  fitViewport,
  NO_INSETS,
  viewportToLogical,
  vec2,
  type SeatId,
} from '@duelbox/engine';
import {
  isSimulating,
  type Game,
  type GameContext,
  type GameManifest,
  type MatchPhase,
} from '@duelbox/game-sdk';
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
}

export function GameHost({
  manifest,
  createGame,
  seed,
  phase,
  localSeat = 'p1',
  presentation = 'shared-screen',
  botDifficulty,
  onTick,
  onScore,
  onActiveSeat,
  onRequestPause,
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const logical = manifest.logical;
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
    const turnBased = typeof game.getActiveSeat === 'function';
    const input = new InputManager(logical, {
      split: turnBased ? 'shared' : manifest.zoneSplit === 'vertical' ? 'vertical' : 'horizontal',
      bottomSeat: turnBased ? (game.getActiveSeat?.() ?? localSeat) : localSeat,
    });

    gameRef.current = game;
    const gameContext: GameContext = {
      manifest,
      rng: new Rng(seed),
      presentation,
      localSeat,
      botDifficulty: (seat) => botDifficulty?.[seat] ?? null,
    };
    game.init(gameContext);

    // NO_INSETS, deliberately. Safe-area handling belongs to the layout, which pads the
    // shell so this canvas is already inside the safe region by the time it is measured.
    // Subtracting the root insets here as well shrank the play area twice over on a
    // notched phone, and cost a getComputedStyle on every resize to do it.
    let view = fitViewport(logical, canvas.clientWidth, canvas.clientHeight, NO_INSETS);
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
      view = fitViewport(logical, cssWidth, cssHeight, NO_INSETS);
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
    el.addEventListener('pointercancel', onPointerUp);
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

    const loop = new FixedLoop({
      update(dt) {
        // The shell's clock runs in every live phase; the simulation only while playing.
        onTickRef.current?.(dt);
        if (!isSimulating(phaseRef.current)) {
          // Input still has to be drained, or a key held through a countdown arrives as
          // a fresh press on the first simulated step.
          input.beginStep(dt);
          return;
        }
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
          // The board changed hands, so the pointer surface does too.
          if (seat !== null) input.setBoardSeat(seat);
          onActiveSeatRef.current?.(seat);
        }
      },
      render(alpha) {
        renderer.beginFrame();
        game.render(renderer, alpha);
        renderer.endFrame();
      },
    });
    loopRef.current = loop;

    const runner = new RunLoop(loop, browserClock());
    runnerRef.current = runner;

    // A host rebuilt mid-match must come back running if the phase says it should be.
    // The phase effect below only fires when the phase *changes*, so a host recreated
    // while the phase stayed the same would be left stopped for good — the match would
    // hang wherever it was, with no error and nothing in the console.
    if (phaseRef.current === 'countdown' || phaseRef.current === 'playing') runner.start();

    function onVisibility(): void {
      // Tab-switching must not fast-forward the accumulator, and a hidden match must not
      // keep burning battery. The shell is told; it owns the decision.
      if (document.hidden) onRequestPauseRef.current?.();
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      runner.stop();
      if (resizeHandle !== 0) globalThis.cancelAnimationFrame(resizeHandle);
      runnerRef.current = null;
      loopRef.current = null;
      gameRef.current = null;
      observer.disconnect();
      motion.removeEventListener('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibility);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('contextmenu', onContextMenu);
      globalThis.removeEventListener('keydown', onKeyDown);
      globalThis.removeEventListener('keyup', onKeyUp);
      globalThis.removeEventListener('keyup', onModifierRelease);
      globalThis.removeEventListener('blur', onBlur);
      game.destroy();
    };
  }, [manifest, createGame, seed, localSeat, presentation, botDifficulty]);

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
