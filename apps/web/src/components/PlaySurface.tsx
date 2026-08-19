'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Game, GameManifest } from '@duelbox/game-sdk';
import { loadGame } from '@/data/registry';
import { GameHost } from './GameHost';
import { seatColour } from '@/styles/tokens';
import styles from './PlaySurface.module.css';

type Mode = 'friend' | 'bot';
type Phase = 'loading' | 'ready' | 'playing' | 'over' | 'error';

interface Score {
  p1: number;
  p2: number;
  winner: 'p1' | 'p2' | 'draw' | null;
}

/**
 * The shared match flow every game runs inside: choose a mode, play, see the result,
 * play again. Games supply only the win condition — building this per game is how 107
 * inconsistent versions happen.
 */
export function PlaySurface({ slug }: { slug: string }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [manifest, setManifest] = useState<GameManifest | null>(null);
  const [create, setCreate] = useState<(() => Game) | null>(null);
  const [mode, setMode] = useState<Mode>('friend');
  const [score, setScore] = useState<Score>({ p1: 0, p2: 0, winner: null });
  // A new seed per match keeps a rematch from replaying the previous one exactly.
  const [seed, setSeed] = useState(1);

  useEffect(() => {
    let cancelled = false;
    loadGame(slug)
      .then((loaded) => {
        if (cancelled) return;
        setManifest(loaded.manifest);
        setCreate(() => () => loaded.create());
        setPhase('ready');
      })
      .catch(() => {
        if (!cancelled) setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const handleScore = useCallback((p1: number, p2: number, winner: 'p1' | 'p2' | 'draw' | null) => {
    setScore({ p1, p2, winner });
    if (winner) setPhase('over');
  }, []);

  const start = useCallback((chosen: Mode) => {
    setMode(chosen);
    setScore({ p1: 0, p2: 0, winner: null });
    setSeed((previous) => previous + 1);
    setPhase('playing');
  }, []);

  if (phase === 'error') {
    return (
      <div className={styles.state} role="alert">
        <h2>This game is not playable yet</h2>
        <p>Its rules and controls are settled, but the build has not landed. Try another game.</p>
      </div>
    );
  }

  if (phase === 'loading' || !manifest || !create) {
    return (
      <div className={styles.state}>
        <p>Loading {slug.replace(/-/g, ' ')}…</p>
      </div>
    );
  }

  if (phase === 'ready') {
    return (
      <div className={styles.state}>
        <h2>{manifest.name}</h2>
        <div className={styles.modes}>
          {manifest.modes.includes('friend') ? (
            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                start('friend');
              }}
            >
              Play together here
            </button>
          ) : null}
          {manifest.modes.includes('bot') ? (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                start('bot');
              }}
            >
              Play against Bo
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.surface}>
      <div className={styles.hud}>
        <span className={styles.seat} style={{ color: seatColour.p1.base }}>
          {seatColour.p1.name} <b>{score.p1}</b>
        </span>
        <span className={styles.versus}>vs</span>
        <span className={styles.seat} style={{ color: seatColour.p2.base }}>
          <b>{score.p2}</b> {mode === 'bot' ? seatColour.p2.name : 'Player two'}
        </span>
      </div>

      <div className={styles.board}>
        <GameHost
          manifest={manifest}
          createGame={create}
          seed={seed}
          presentation="shared-screen"
          localSeat="p1"
          {...(mode === 'bot' ? { botDifficulty: { p2: 'normal' as const } } : {})}
          onScore={handleScore}
        />
      </div>

      {phase === 'over' ? (
        <div className={styles.result} role="status">
          <p className={styles.winner}>
            {score.winner === 'draw'
              ? 'A draw'
              : `${score.winner === 'p1' ? seatColour.p1.name : seatColour.p2.name} wins`}
          </p>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              start(mode);
            }}
          >
            Play again
          </button>
        </div>
      ) : null}
    </div>
  );
}
