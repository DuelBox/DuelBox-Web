import type { Metadata } from 'next';
import Link from 'next/link';
import { CATALOGUE } from '@/data/catalogue.generated';
import { PLAYABLE } from '@/data/registry';
import { SEAT_CHARACTERS, SEAT_KEYS } from '@/lib/seats';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'How to play',
  description:
    'Two people, one device, no accounts. How seats work, what the keys do, and what to do if you only have one pair of hands.',
};

/**
 * The page the header has always linked to.
 *
 * It linked to nothing: `/how-to-play/` was not a route, so two of the four navigation
 * links on every page of the site were dead. This is the page, and the Tournament link
 * has gone until there is a tournament to link to.
 */
export default function HowToPlayPage() {
  const playable = PLAYABLE.length;

  return (
    <div className="db-wrap">
      <header className={styles.head}>
        <h1>How to play</h1>
        <p className={styles.lede}>
          Two people, one device, no accounts and nothing to install. Put the phone or laptop
          between you, pick a game, and start. {playable} of the {CATALOGUE.length} games in the
          catalogue are playable today.
        </p>
      </header>

      <section className={styles.section}>
        <h2>Sit opposite each other</h2>
        <p>
          Both players share one screen from opposite sides. The device does not need to be handed
          back and forth: each half belongs to the person nearest it, and a touch belongs to the
          seat it started in even if your finger crosses the middle.
        </p>
        <p>
          The two seats are {SEAT_CHARACTERS.p1} and {SEAT_CHARACTERS.p2}. Whoever sits in a seat
          plays under its name and its mark — a disc for {SEAT_CHARACTERS.p1}, a rounded square for{' '}
          {SEAT_CHARACTERS.p2} — so the scoreboard, the keys below and the pieces on the board all
          mean the same person. A bot takes a seat under the same name.
        </p>
        <div className={styles.device} aria-hidden="true">
          <div className={`${styles.seat} ${styles.seatTop}`}>{SEAT_CHARACTERS.p2}</div>
          <div className={styles.divider} />
          <div className={`${styles.seat} ${styles.seatBottom}`}>{SEAT_CHARACTERS.p1}</div>
        </div>
        <p>
          In games played turn by turn the board turns to face whoever is to move, so you always
          read it the right way up — and while it is your turn the whole screen is yours to reach.
          In games played at the same time, the screen stays put and each of you has your own half.
        </p>
      </section>

      <section className={styles.section}>
        <h2>On a keyboard</h2>
        <p>
          Two people sharing a laptop have one keyboard between them, so the keys are split rather
          than shared. Every game lists its own controls on its page; these are the defaults.
        </p>
        {/* The same `SEAT_KEYS` the in-game control legend draws. Written out twice they
            drift, and a guide that disagrees with the game is worse than no guide. */}
        <table className={styles.keys}>
          <thead>
            <tr>
              <th scope="col">Seat</th>
              <th scope="col">Move</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {SEAT_KEYS.map(({ seat, move, action }) => (
              <tr key={seat}>
                <th scope="row">{SEAT_CHARACTERS[seat]}</th>
                <td>
                  {move.split(' ').map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </td>
                <td>
                  <kbd>{action}</kbd>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <kbd>Esc</kbd> pauses at any time, for either player.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Playing on your own</h2>
        <p>
          Every game offers a bot in three strengths. A bot never sees anything you cannot see and
          never moves faster than a person could — the difference between the strengths is how far
          it thinks ahead and how often it makes a mistake, never what it knows.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Things worth knowing</h2>
        <div className={styles.cards}>
          <div className={styles.card}>
            <h3>A loaded game needs nothing</h3>
            <p>
              Once a page has loaded, playing it needs no network at all. Closing the tab and coming
              back does need one — there is no offline cache yet.
            </p>
          </div>
          <div className={styles.card}>
            <h3>No accounts, no data</h3>
            <p>
              There is nothing to sign up for and nothing to log in to. The only thing kept on your
              device is what you last chose for a game — the mode, the bot level and the match
              length. Scores are not saved anywhere.
            </p>
          </div>
          <div className={styles.card}>
            <h3>Colour is never the only signal</h3>
            <p>
              Each player&apos;s pieces differ in shape as well as colour, so every game is playable
              in greyscale and to a colour-blind player.
            </p>
          </div>
          <div className={styles.card}>
            <h3>Any screen</h3>
            <p>
              The same game runs on a phone, a tablet and a laptop, and neither player ever sees
              more of the play area than the other.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Ready?</h2>
        <p>
          <Link href="/games/">Browse all games</Link> and pick one.
        </p>
      </section>
    </div>
  );
}
