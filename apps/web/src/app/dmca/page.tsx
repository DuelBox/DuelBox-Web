import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'DMCA & abuse',
  description:
    'How to report a copyright or abuse concern about DuelBox, what to include, and when to expect a reply.',
};

/**
 * The public DMCA and abuse contact route (#216).
 *
 * The internal procedure and timeline live in `docs/abuse-response.md`; this page is the
 * outward-facing half — where to write, what a usable notice contains, and what to expect back.
 * The contact address is a PLACEHOLDER (`abuse@duelbox.example`) until the owner supplies a real
 * monitored inbox; the note below says so plainly rather than implying a live channel.
 */
export default function DmcaPage() {
  return (
    <div className="db-wrap">
      <header className={styles.head}>
        <h1>DMCA &amp; abuse</h1>
        <p className={styles.updated}>Copyright claims and abuse reports.</p>
      </header>

      <div className={styles.prose}>
        <p className={styles.lead}>
          If you believe something on DuelBox infringes your copyright or trademark, or is otherwise
          abusive, tell us directly. A claim that reaches us is one we can answer; DuelBox builds
          its games from scratch, and we would rather resolve a concern than have it escalate to our
          host.
        </p>

        <p className={styles.placeholder} role="note">
          <strong>Note:</strong> the contact address below is a placeholder (
          <code>abuse@duelbox.example</code>) and is not yet a monitored inbox. It must be replaced
          with the real address before launch.
        </p>

        <h2>How to reach us</h2>
        <p>
          Email <a href="mailto:abuse@duelbox.example">abuse@duelbox.example</a>. For something
          already public you may also open a GitHub issue, but a claim asserting infringement is
          better sent by email so it is assessed before it is amplified.
        </p>
        <p>
          A <strong>security vulnerability</strong> is not this — please report it privately through
          our{' '}
          <a
            href="https://github.com/DuelBox/DuelBox-Web/security/advisories/new"
            rel="noopener noreferrer"
            target="_blank"
          >
            security advisory process
          </a>{' '}
          instead.
        </p>

        <h2>What a copyright notice should include</h2>
        <p>So we can act on a takedown notice without a round-trip, please include:</p>
        <ul>
          <li>Identification of the work you say is being infringed.</li>
          <li>
            Identification of the material on DuelBox you are reporting — a URL, a game name, or the
            specific screen — with enough detail for us to find it.
          </li>
          <li>Your contact details.</li>
          <li>A statement that you believe in good faith the use is not authorised.</li>
          <li>
            A statement, under penalty of perjury, that your notice is accurate and that you are the
            rights holder or authorised to act for them.
          </li>
          <li>Your physical or electronic signature.</li>
        </ul>

        <h2>What to expect</h2>
        <p>
          We aim to acknowledge a report within three working days, give a first assessment within
          ten, and either act on it or send a dated plan within fourteen working days of that
          assessment. If material is removed on a valid notice and you believe that was a mistake, a
          counter-notice process applies before it is restored.
        </p>

        <h2>Why most claims are quick to resolve</h2>
        <p>
          DuelBox reimplements the rules of public-domain and everyday games — which are not
          protected — and writes its own code, art, sounds and names. We keep a written record of
          the naming and licensing decision for every game, so a concern about a name or an asset is
          usually answered with a document we already hold. See <Link href="/terms/">Terms</Link>{' '}
          and <Link href="/attribution/">Attribution</Link>.
        </p>
      </div>
    </div>
  );
}
