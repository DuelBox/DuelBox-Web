import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Not saved to this device',
  description:
    'This device does not hold the page that was asked for. The games it has already kept are still here, and still play.',
  /**
   * Kept out of search, the way `embed/[slug]` is and for the same reason: this document is
   * a substitute for another page, not a destination. Indexed, it would answer a search for
   * DuelBox with a page headed "Not saved to this device" — a sentence that is only ever true
   * of the device reading it, and false of every crawler that would find it here. `follow`
   * stays on so the catalogue link below is still a route a crawler can take.
   *
   * It is absent from `sitemap.ts` for the same reason. That file is not this batch's to
   * edit and needs no change: it lists what a crawler should fetch, and this is not that.
   */
  robots: { index: false, follow: true },
};

/**
 * The page a player meets on the worst day, and the only one the device is promised to have.
 *
 * The service worker precaches this document, so it is the one page that is always here. When
 * a navigation asks for a page this device has never held and the network cannot supply one,
 * the worker answers with this instead of letting the browser draw its own error screen. That
 * is the whole of its job, and it is why it is worth more care than its size suggests: a
 * player who has just lost their connection and pressed a game is the least patient reader
 * this product has, and the page they land on is the only thing between them and the
 * impression that the site is broken.
 *
 * **It never learns which page was asked for.** The worker answers the request with this
 * document rather than sending the browser somewhere else, so the address bar still says
 * `/play/sudoku/`; and a static export has no request to read at build time in any case. So
 * every sentence here has to be true of any address on the site, which is why nothing below
 * names a game.
 *
 * ## Not a byte of client JavaScript, deliberately
 *
 * This is a server component that imports its own stylesheet and `next/link`, and that is the
 * whole of it. Three reasons, in the order they matter:
 *
 * 1. **It has to render from the precached document alone.** Anything that waited for
 *    hydration would be blank at the exact moment hydration is least likely to happen, and it
 *    is the page whose premise is that fetches are failing. The same argument answers "does it
 *    work with scripting off": there is nothing here that scripting was doing.
 * 2. **Every visitor pays for it.** `scripts/check-size.mjs` bills the eager scripts of every
 *    non-play route to the shell budget, so a client component on a route almost nobody opens
 *    is a download for everybody who opens anything. Measured against this build's manifests:
 *    a server route of this shape costs 249–307 B gzipped for its own chunk — the segment stub
 *    Next emits for any route at all, plus the class-name map its stylesheet needs. The
 *    stylesheet itself is free, because that guard walks `.js` and nothing else.
 * 3. **The one dynamic thing this page could show is already shown, once, somewhere better.**
 *    A live "here is what you do have" list would mean reading the Cache API from a component
 *    on the shell budget — a second mechanism for a fact the offline-aware catalogue (#193)
 *    already renders on every game in the list. Two mechanisms for one fact is how they come
 *    to disagree. So this page teaches the catalogue's two marks, in the catalogue's own
 *    words, and sends the player there.
 *
 * **There is no Retry button.** A control that cannot know when it will succeed is a control
 * that lies, and pressing it would do exactly what the reload the browser already has does.
 * `docs/interface-voice.md` is explicit that the shell does not apologise or reassure; offering
 * a button so the page feels active is the same failure in a different costume.
 *
 * **It does not say "you are offline" either**, because it cannot know that. The fetch that
 * failed was the worker's, not this document's, and the same bytes are served to somebody who
 * opens `/offline/` with a perfectly good connection. What does know is the indicator: the
 * `html[data-net]` attribute and the `role="status"` bar that `globals.css` styles carry a live
 * reading and appear on this page like any other. A baked-in sentence would be right most of
 * the time, which is the worst thing a status line can be.
 *
 * ## The heading
 *
 * `Not saved to this device` is pinned by `e2e/offline.spec.ts` — "a game never opened says so,
 * rather than showing a browser error" waits for a heading with exactly that accessible name.
 * `offline-page.test.ts` beside this file holds the two together, so rewording it fails in
 * `pnpm test` in a second rather than in the browser three minutes later.
 *
 * ## Rule 7
 *
 * The only state on this page is carried in words. The two marks below are the catalogue's own
 * two strings, quoted, and neither of them is a colour, a dot or a shade — which is also what
 * makes them readable in the screenshot somebody sends when they are reporting this.
 */
export default function OfflinePage() {
  return (
    <div className="db-wrap">
      <div className={styles.panel}>
        <h1 className={styles.title}>Not saved to this device</h1>
        <p className={styles.lede}>
          DuelBox keeps a page on your device once you have opened it there, and this address is not
          one of them yet. Nothing is broken and nothing of yours is lost — the page has not arrived
          here.
        </p>
        <p className={styles.body}>
          A game asks the network for one thing, itself. Once its page and its code are on the
          device, the rules, the bot and the scoring all run here, which is why a match never waits
          for anything. So a game you have already played is still yours to play now.
        </p>
        <p className={styles.body}>
          The catalogue knows which is which. While you are away from a connection it marks every
          game in the list as one of two things:
        </p>
        {/*
          The two strings, quoted from the catalogue rather than paraphrased. `globals.css`
          renders them as `content:` on a link with `data-offline-ready` of 1 or 0, and
          `offline-page.test.ts` fails if the wording there and the wording here stop matching —
          a legend that teaches a vocabulary the page it points at no longer uses is worse than
          no legend, because the player then distrusts both.
        */}
        <dl className={styles.marks}>
          <div>
            <dt>Saved on this device</dt>
            <dd>It is here. Open it and play.</dd>
          </div>
          <div>
            <dt>Needs a connection</dt>
            <dd>It has not arrived here yet, like the one you just asked for.</dd>
          </div>
        </dl>
        <p className={styles.body}>
          Opening a game once, while you have a connection, is enough: this device keeps it for next
          time.
        </p>
        <div className={styles.actions}>
          {/*
            One way onward, not the two the 404 offers, and the difference is the situation. A
            wrong address could have meant either of two pages, so that panel offers both; here
            there is exactly one page worth opening, and it is the one that can say which games
            are already here. The header above carries the rest of the site for anybody who
            wanted something else.

            A `Link`, so the base path comes with it. `app/base-path.ts` names a hand-built URL
            as the way a page 404s on the deployed host, and this page has exactly one URL in
            it — the cheapest possible way not to be the file that proves the point.
          */}
          <Link href="/games/" className={styles.primary}>
            All games
          </Link>
        </div>
      </div>
    </div>
  );
}
