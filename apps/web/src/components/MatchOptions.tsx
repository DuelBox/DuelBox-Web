'use client';

import { useId } from 'react';
import { seatColour } from '@/styles/tokens';
import { BOT_DIFFICULTIES, ROUND_CHOICES, type BotDifficulty } from '@/lib/match-setup';
import styles from './MatchOptions.module.css';

/**
 * The two things a player settles before a match starts: how hard the bot tries, and how
 * many rounds it takes to win.
 *
 * Both existed and neither could be reached. Every one of the 107 games implements three
 * tiers, each tuned over many commits and each with a measured win rate written into its
 * spec, and the shell hardcoded `normal`; the SDK implements best-of and the shell
 * hardcoded one round. This is the screen that hands both back to the player.
 *
 * Native radios rather than a row of buttons, because a radio group is a keyboard control
 * for free — arrow keys move within it, Tab skips past it, and a screen reader announces
 * "2 of 3". A button row that looked identical would need every one of those written by
 * hand, and the version of it that gets written by hand is the version that gets them
 * wrong.
 *
 * Colour is never the only signal (CLAUDE.md rule 7): each option carries its own words,
 * the chosen one shows the radio's own filled dot, and the tiers additionally count
 * themselves out in pips, so the ladder reads in greyscale.
 */

export interface MatchOptionsProps {
  /**
   * Whether to offer a bot tier at all.
   *
   * False for a game with no bot to play, where a difficulty control would be offering a
   * choice that changes nothing. Every playable manifest offers one today.
   */
  showDifficulty: boolean;
  difficulty: BotDifficulty;
  onDifficulty: (difficulty: BotDifficulty) => void;
  rounds: number;
  onRounds: (rounds: number) => void;
}

interface Choice {
  /** Also the radio's value, which is what lets both groups be one component. */
  readonly value: string;
  readonly label: string;
  /** The tier counted out, for a ladder that has to read without colour. */
  readonly pips?: string;
}

const PIPS = ['●○○', '●●○', '●●●'];

const TIERS: readonly Choice[] = BOT_DIFFICULTIES.map((tier, index) => ({
  value: tier,
  label: `${tier[0]?.toUpperCase() ?? ''}${tier.slice(1)}`,
  pips: PIPS[index] ?? '',
}));

/**
 * The lengths, said the way a player would say them out loud.
 *
 * "1 round" rather than "one round" only because on a 412px phone the spelled-out version
 * wraps onto a second line and its neighbours do not, which reads as a broken column.
 */
const LENGTHS: readonly Choice[] = ROUND_CHOICES.map((rounds) => ({
  value: String(rounds),
  label: rounds === 1 ? '1 round' : `Best of ${String(rounds)}`,
}));

export function MatchOptions({
  showDifficulty,
  difficulty,
  onDifficulty,
  rounds,
  onRounds,
}: MatchOptionsProps) {
  // Unique per instance: two radio groups on one page must not share a name, or picking a
  // tier would clear the match length.
  const id = useId();
  return (
    <div className={styles.options}>
      {showDifficulty ? (
        <Group
          name={`${id}-tier`}
          legend={`${seatColour.p2.name}’s skill`}
          choices={TIERS}
          chosen={difficulty}
          onChoose={(value) => {
            onDifficulty(value as BotDifficulty);
          }}
        />
      ) : null}
      <Group
        name={`${id}-length`}
        legend="Match length"
        choices={LENGTHS}
        chosen={String(rounds)}
        onChoose={(value) => {
          onRounds(Number(value));
        }}
      />
    </div>
  );
}

/** One radio group. Written once, because a second copy is a second thing to get wrong. */
function Group({
  name,
  legend,
  choices,
  chosen,
  onChoose,
}: {
  name: string;
  legend: string;
  choices: readonly Choice[];
  chosen: string;
  onChoose: (value: string) => void;
}) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.choices}>
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={[styles.choice, choice.value === chosen ? styles.chosen : ''].join(' ')}
          >
            <input
              type="radio"
              className={styles.radio}
              name={name}
              value={choice.value}
              checked={choice.value === chosen}
              onChange={() => {
                onChoose(choice.value);
              }}
            />
            <span className={styles.name}>{choice.label}</span>
            {choice.pips === undefined ? null : (
              <span className={styles.pips} aria-hidden="true">
                {choice.pips}
              </span>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
