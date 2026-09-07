'use client';

import { useEffect, useId, useState } from 'react';
import type { GameOption } from '@duelbox/game-sdk';
import {
  defaultOptionValues,
  readOptionValues,
  writeOptionValue,
  type OptionValue,
} from './game-options';
import styles from './GameOptionsPanel.module.css';

/**
 * The generic per-game options panel (#1751).
 *
 * A game declares its options as typed schema entries in its manifest — a board size, a round
 * length, a variant toggle — and this renders them with **no bespoke UI per game**: a select
 * becomes a dropdown, a toggle a switch, a range a slider, all from the schema alone. A game
 * with no options renders nothing, so the pre-match screen is unchanged for the games that
 * have none.
 *
 * Choices persist per game in `localStorage`, mirroring `last-mode`, and are read back on the
 * next visit so the panel opens on what the pair last chose. The values are loaded in an
 * effect rather than during render, because the site is a static export and reading storage
 * while rendering would make the server's HTML and the first paint disagree — the defaults
 * render, and the remembered choices replace them a frame later.
 */
export interface GameOptionsPanelProps {
  slug: string;
  options: readonly GameOption[];
  /** Told whenever a value changes, so the match flow can apply the new options at start. */
  onChange?: (values: Record<string, OptionValue>) => void;
}

export function GameOptionsPanel({ slug, options, onChange }: GameOptionsPanelProps) {
  const [values, setValues] = useState<Record<string, OptionValue>>(() =>
    defaultOptionValues(options),
  );
  const baseId = useId();

  useEffect(() => {
    const stored = readOptionValues(slug, options);
    setValues(stored);
    onChange?.(stored);
    // `onChange` is intentionally not a dependency: it fires once with what was loaded, and a
    // parent passing a fresh function each render must not re-trigger a storage read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, options]);

  // A game with nothing to configure shows no panel at all.
  if (options.length === 0) return null;

  function set(id: string, value: OptionValue): void {
    setValues((previous) => {
      const next = { ...previous, [id]: value };
      onChange?.(next);
      return next;
    });
    writeOptionValue(slug, id, value);
  }

  return (
    <section className={styles.panel} aria-label="Game options">
      {options.map((option) => {
        const controlId = `${baseId}-${option.id}`;
        return (
          <div key={option.id} className={styles.row}>
            <label className={styles.label} htmlFor={controlId}>
              {option.label}
            </label>
            {option.type === 'select' ? (
              <select
                id={controlId}
                className={styles.select}
                value={String(values[option.id] ?? option.default)}
                onChange={(event) => {
                  set(option.id, event.target.value);
                }}
              >
                {option.choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            ) : null}
            {option.type === 'toggle' ? (
              <input
                id={controlId}
                type="checkbox"
                className={styles.toggle}
                checked={Boolean(values[option.id] ?? option.default)}
                onChange={(event) => {
                  set(option.id, event.target.checked);
                }}
              />
            ) : null}
            {option.type === 'range' ? (
              <span className={styles.range}>
                <input
                  id={controlId}
                  type="range"
                  min={option.min}
                  max={option.max}
                  step={option.step}
                  value={Number(values[option.id] ?? option.default)}
                  onChange={(event) => {
                    set(option.id, Number(event.target.value));
                  }}
                />
                <output className={styles.value} htmlFor={controlId}>
                  {String(values[option.id] ?? option.default)}
                </output>
              </span>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
