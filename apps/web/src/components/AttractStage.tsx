'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Canvas2DRenderer,
  FixedLoop,
  InputManager,
  InputView,
  NO_INSETS,
  Rng,
  RunLoop,
  browserClock,
  clampDevicePixelRatio,
  negotiateSharedViewport,
  zoneSplitFor,
} from '@duelbox/engine';
import type { Game, GameManifest } from '@duelbox/game-sdk';
import { loadGame } from '@/data/registry';
import {
  FRAME_DIVISOR,
  isLowBattery,
  nextAttractSeed,
  type BatteryReading,
} from '@/lib/attract-mode';
import { T } from '@/lib/i18n/T';
import { pickQuickPlay } from '@/lib/quick-play';
import { readRecent } from '@/lib/recent';
import { SEAT_CHARACTERS } from '@/lib/seats';

/**
 * The match that plays itself on an idle catalogue (#165): two bots, one canvas, no input.
 *
 * ## Why this is not `GameHost`
 *
 * The host is built for a person: it listens on the window for keys and on the canvas for
 * pointers, it is focusable so a seat's action key reaches the game rather than a button,
 * it renders every frame, and it pauses on blur. Every one of those is wrong here. Nobody
 * is playing — any input at all ends the display, in the shell, before this file hears of
 * it — so there is nothing to listen for; a focusable canvas on a catalogue would be a tab
 * stop that goes nowhere; and the one thing the issue asks for that the host cannot do at
 * all is draw fewer frames than it steps. Adding a render-rate prop to the host to get that
 * would put a display-mode branch into the file every real match runs through. So this is
 * the smallest loop the engine allows: the same `FixedLoop`, `RunLoop`, renderer, input
 * manager and `Rng` the host uses, in the same order, with the parts a person needs left out.
 *
 * ## The rules that still apply with nobody watching
 *
 * Rule 4: the match is seeded, and the next round takes `nextAttractSeed` of the last, so
 * two idle catalogues showing the same game show the same match. Rule 5: the step and
 * render paths allocate nothing of their own — the frame counter is a number in a closure
 * and the score read is the same read the host makes. Rule 8: the game sees its logical
 * box and nothing else; the canvas is sized, the box is not. Rule 10: no branch on device.
 *
 * ## Frame rate
 *
 * `RunLoop` steps the simulation at its fixed rate whatever this does — that is rule 8, and
 * the match would diverge otherwise — and this draws one frame in every `FRAME_DIVISOR`.
 * On a 60 Hz display that is 30 drawn frames a second for a display nobody is aiming at.
 *
 * ## Battery
 *
 * `navigator.getBattery` is asked here, once, before anything starts, and a device at or
 * under the floor and unplugged gets nothing — `onStop`, and the shell's timer goes back to
 * waiting. WebKit has no battery API; a missing API reads as "not low" and the match plays,
 * which is what the shell's reduced-motion and save-data checks are there to catch on the
 * platforms that offer those instead.
 */
export default function AttractStage({
  slugs,
  onStop,
}: {
  slugs: readonly string[];
  onStop: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<{
    slug: string;
    manifest: GameManifest;
    create: () => Game;
  } | null>(null);
  const [seed, setSeed] = useState(1);
  const stopRef = useRef(onStop);
  stopRef.current = onStop;

  useEffect(() => {
    let live = true;
    void readBattery().then((battery) => {
      if (!live) return;
      if (isLowBattery(battery)) {
        stopRef.current();
        return;
      }
      // The same picker as "Surprise me", against the same recent list, so the catalogue
      // demonstrates a game the pair have not just played. `Math.random` is fine here and
      // forbidden in `packages/**`: this chooses a game, it does not step one.
      const slug = pickQuickPlay(slugs, readRecent(), Math.random);
      if (slug === undefined) {
        stopRef.current();
        return;
      }
      loadGame(slug)
        .then((game) => {
          if (!live) return;
          setLoaded({ slug, manifest: game.manifest, create: () => game.create() });
        })
        .catch(() => {
          if (live) stopRef.current();
        });
    });
    return () => {
      live = false;
    };
  }, [slugs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (loaded === null || canvas === null) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const { manifest, create } = loaded;
    const logical = manifest.logical;
    const renderer = new Canvas2DRenderer(context, logical);
    // Never started under reduced motion, so the renderer's own effects are the plain ones.
    renderer.setReducedMotion(false);
    const input = new InputManager(logical, {
      split: zoneSplitFor('single-seat', manifest.zoneSplit, null),
      bottomSeat: 'p1',
    });
    const inputView = new InputView();
    const game = create();
    game.init({
      manifest,
      rng: new Rng(seed),
      presentation: 'single-seat',
      localSeat: 'p1',
      openingSeat: 'p1',
      reducedMotion: false,
      botDifficulty: () => 'normal',
    });

    let lastWidth = -1;
    let lastHeight = -1;
    let lastDpr = -1;
    const resize = (): void => {
      const dpr = clampDevicePixelRatio(globalThis.devicePixelRatio);
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      if (cssWidth === lastWidth && cssHeight === lastHeight && dpr === lastDpr) return;
      lastWidth = cssWidth;
      lastHeight = cssHeight;
      lastDpr = dpr;
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderer.setViewport(
        negotiateSharedViewport(
          { logical, screenWidth: cssWidth, screenHeight: cssHeight, insets: NO_INSETS },
          logical,
        ).view,
      );
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const stopWatch = renderer.watchSurface(
      canvas,
      () => {
        // A lost surface on a display nobody is watching is not worth recovering.
        stopRef.current();
      },
      () => {
        lastWidth = -1;
        resize();
      },
    );

    let frames = 0;
    let over = false;
    let nextRound = 0;
    const loop = new FixedLoop({
      update(dt) {
        if (over) return;
        try {
          game.update(dt, inputView.sync(input.beginStep(dt)));
          if (game.getScore().winner !== null) {
            over = true;
            // Long enough to read the result, short enough that the display never sits on one.
            nextRound = window.setTimeout(() => {
              setSeed(nextAttractSeed);
            }, 2000);
          }
        } catch {
          stopRef.current();
        }
      },
      render(alpha) {
        frames += 1;
        if (frames % FRAME_DIVISOR !== 0 || renderer.surfaceLost) return;
        try {
          renderer.beginFrame();
          game.render(renderer, alpha);
          renderer.endFrame();
        } catch {
          stopRef.current();
        }
      },
    });
    const runner = new RunLoop(loop, browserClock());
    runner.start();
    return () => {
      runner.stop();
      window.clearTimeout(nextRound);
      stopWatch();
      observer.disconnect();
      game.destroy();
    };
  }, [loaded, seed]);

  return (
    <div className="db-attract" data-attract={loaded === null ? 'loading' : 'playing'}>
      {/*
        `aria-hidden` and `inert`: a match nobody is playing is decoration, not content — a
        screen reader is told nothing, and nothing in it can take focus. The caption below is
        outside both, because it is the one true sentence here and it carries the link.
      */}
      <div aria-hidden="true" inert>
        <canvas ref={canvasRef} className="db-attract-canvas" />
      </div>
      {loaded === null ? null : (
        <p className="db-attract-caption">
          {/* One sentence with three values in it, two seat names and a link, so a translator
              gets the whole line and can put the link where their grammar wants it (#220).
              The names themselves are characters rather than words and are not translated. */}
          <T
            id="{one} and {two} are playing {game} — move to stop."
            values={{
              one: SEAT_CHARACTERS.p1,
              two: SEAT_CHARACTERS.p2,
              game: <Link href={`/play/${loaded.slug}/`}>{loaded.manifest.name}</Link>,
            }}
          />
        </p>
      )}
    </div>
  );
}

/** The battery, from the one browser family that reports it; null everywhere else. */
async function readBattery(): Promise<BatteryReading | null> {
  const getBattery = (navigator as { getBattery?: () => Promise<BatteryReading> }).getBattery;
  if (typeof getBattery !== 'function') return null;
  try {
    const battery = await getBattery.call(navigator);
    return { level: battery.level, charging: battery.charging };
  } catch {
    return null;
  }
}
