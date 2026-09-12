import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { ServiceWorkerBridge } from '@/components/ServiceWorkerBridge';
import { LocaleProvider } from '@/lib/i18n/provider';
import {
  FRAMED_NOTICE_ID,
  FRAMED_NOTICE_LINK,
  FRAMED_NOTICE_TEXT,
  FRAME_GUARD,
} from './frame-guard';
import { BASE_PATH } from './base-path';
import { SITE_SHARE_IMAGE } from '@/lib/share-image';
import { SITE_URL } from '@/lib/site';
import { colour } from '@/styles/tokens';
import './globals.css';

export const metadata: Metadata = {
  // The address every relative metadata URL resolves against, base path included: Next joins
  // the two paths rather than replacing one, so `/games/chess/` becomes
  // `/DuelBox-Web/games/chess/` and not a route the origin has never served.
  metadataBase: new URL(`${SITE_URL}/`),
  // Every route names itself as canonical (#201). Relative, so Next resolves it against the
  // page being rendered rather than against this file: a query-string or hash variant of any
  // route then points a crawler at the clean address. The three routes that already declare
  // their own replace this rather than merging with it, which is why they still say so.
  alternates: { canonical: './' },
  title: {
    default: 'DuelBox — 108 games for two players',
    template: '%s — DuelBox',
  },
  // Two claims were wrong here, and this is the object every one of the 223 exported pages
  // inherits when it does not set its own — so a sentence in it is the most-repeated
  // sentence on the site, and the least-read by anybody in a position to notice.
  //
  // "Play across two devices" is a feature this build does not have. `PlayMode` in
  // `lib/match-setup.ts` is `'friend' | 'bot'`, the catalogue's whole mode vocabulary is
  // `friend`, `bot` and `solo`, and there is no pairing route, no signalling and no
  // concrete transport anywhere in `apps/web`; `lib/landing.ts` carries the long form of
  // the evidence, because #102 took the same claim off the hero and out of the three
  // cards. Taking it off the visible page and leaving it in the description every route
  // inherits would have left the landing page contradicting its own `<meta>` tag.
  //
  // "A hundred and seven games" was the second, and it disagreed with the title two lines
  // above it: `CATALOGUE.length` is 108. `metadata-claims.test.ts` now holds both — the
  // count against the catalogue, and the mode wording against `PlayMode` — because a
  // number written out in words is a number nothing recomputes.
  description:
    'A hundred and eight games for two people. Share one screen, two of you either side ' +
    'of it, or take on a bot. No download, no account.',
  applicationName: 'DuelBox',
  /**
   * Written out rather than left to the file conventions, because a project page serves
   * from `/<repo>/` and an icon href that forgets it 404s on the host this site is on.
   * `manifest.ts` next door is picked up automatically and builds its own URLs the same way.
   */
  icons: {
    icon: [
      { url: `${BASE_PATH}/icons/icon.svg`, type: 'image/svg+xml' },
      { url: `${BASE_PATH}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
    ],
    apple: { url: `${BASE_PATH}/icons/apple-touch-icon.png`, sizes: '180x180' },
  },
  openGraph: {
    type: 'website',
    siteName: 'DuelBox',
    title: 'DuelBox — 108 games for two players',
    description: 'Share one screen, two of you either side of it, or take on a bot.',
    // The card every route inherits unless it names its own (#2453). A route that sets its
    // own `openGraph` replaces this object rather than merging with it, which is why the
    // two that do — a game's page and a category hub — each carry `images` of their own.
    images: [SITE_SHARE_IMAGE],
  },
  twitter: {
    card: 'summary',
    title: 'DuelBox — 108 games for two players',
    description: 'Share one screen, two of you either side of it, or take on a bot.',
    images: [SITE_SHARE_IMAGE],
  },
};

export const viewport: Viewport = {
  // The colour the browser paints its own chrome, and the one place the brand was written
  // out a second time. `styles/tokens.test.ts` scans stylesheets, so a hex in a TypeScript
  // object is outside it — which is precisely the shape `page.module.css` records a scar
  // about two rules above one of its own colours. Read from the palette instead: this is a
  // server component and `viewport` is evaluated at build time, so the token costs no
  // bytes, and changing `--db-brand` now changes the chrome with the page.
  themeColor: colour.brand,
  // Zooming is an accessibility tool; the canvas suppresses its own gestures locally
  // rather than the page disabling zoom for everybody.
  initialScale: 1,
  width: 'device-width',
  viewportFit: 'cover',
};

/**
 * No `<head>` of our own, deliberately.
 *
 * It held a `preconnect` pair and a stylesheet link to `fonts.googleapis.com`, and every one
 * of the three was dead on arrival: the site's own CSP is `style-src 'self' 'unsafe-inline'`
 * and `font-src 'self'`, so the stylesheet was refused and the faces behind it would have
 * been refused too. The site rendered in whatever each device defaults to, silently, which
 * is a different face on a phone than on a laptop — for a product built around two people
 * reading one screen, that is not cosmetic.
 *
 * The three families are now served from this origin and declared in `styles/fonts.css`,
 * which `globals.css` imports, so Next emits them as ordinary same-origin assets and the
 * policy needs no widening. Everything else that used to justify a hand-written head —
 * title, description, theme colour, viewport — comes from the `metadata` and `viewport`
 * exports above, and Next writes the `<head>` itself.
 *
 * The one script in here is the frame guard, and it is inline and first for a reason: it is
 * the whole of the clickjacking defence on a host that serves no `X-Frame-Options` and no
 * CSP `frame-ancestors`, and a defence that waits for a chunk to download and React to
 * hydrate leaves a window in which the page is framed, painted and clickable. It costs no
 * JavaScript chunk at all — `emit-host-config.mjs` hashes it into each page's `script-src`
 * along with Next's own bootstrap, so the strict policy covers it without being widened.
 * See `frame-guard.ts` for what it does and does not buy.
 */
/**
 * Applies the saved colour-scheme override before the first paint, so a player who chose
 * dark never sees a flash of the light ground (#76).
 *
 * It has to be an inline script in the markup — a `next/script` or a component effect runs
 * after paint, which is the flash it exists to prevent — so it cannot import `settings.ts`
 * or `theme.ts` and duplicates the storage key and the decision instead. `theme.test.ts`
 * reads this string back and fails if it stops matching what those two files do: the same
 * key, only `light` and `dark` stamped, `system` and everything else left to the media
 * query in `tokens.css`. Wrapped in try/catch because storage throws in private browsing on
 * some engines, and a theme script that throws would take the page down with it.
 *
 * The last two lines stamp `lang` and `dir` from the stored locale (#219, #222) for the same
 * reason and under the same constraint: a right-to-left choice that waited for hydration would
 * paint the shell left-to-right and then flip it. The script cannot import `lib/i18n/locales.ts`,
 * so it carries its own copy of the non-default codes and their directions in `D`, and
 * `lib/i18n/i18n.test.ts` reads that object out of this file and fails if it disagrees with the
 * registry in either direction — a code the registry does not have must never be stamped, and
 * a right-to-left locale the script does not know would flash. English is left to the markup,
 * which already says `lang="en"`, so a visitor who never chose a language runs one lookup. The
 * value is checked against the two directions rather than for truthiness because `l` comes
 * out of storage: a blob with `"locale":"constructor"` would otherwise find `Object` on the
 * lookup's prototype and stamp it.
 *
 * Every byte here is paid 108 times over in the route payloads a catalogue browse prefetches
 * (`size-budget.json`, `_raised_2026_09_08_speculated`). MEASURED on one payload: the first
 * draft, two arrays and two `setAttribute` calls, was 74 gzipped bytes a payload — 8.0 KB over
 * the 108; this shape, one object and the reflected `lang`/`dir` properties, is what replaced
 * it, and `_rederived_2026_09_12_i18n` records the number it came down to. */
const THEME_SCRIPT = `(function(){try{
var raw=localStorage.getItem('duelbox:settings');
var t=raw&&JSON.parse(raw);
var s=t&&t.version===1?t:null;
var el=document.documentElement;
var theme=s?s.theme:null;
if(theme==='light'||theme==='dark')el.setAttribute('data-theme',theme);
else el.removeAttribute('data-theme');
var seats=s?s.seatPalette:null;
if(seats==='colourblind')el.setAttribute('data-seat-palette','colourblind');
else el.removeAttribute('data-seat-palette');
var l=s?s.locale:null,D={'en-XA':'ltr','ar-XB':'rtl'},d=D[l];
if(d==='ltr'||d==='rtl'){el.lang=l;el.dir=d;}
}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the script above sets data-theme on <html> before React
    // hydrates, so the attribute the browser holds differs from the one the server rendered
    // (none). This suppresses the warning for this one element and this one attribute; it
    // does not reach the children.
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* First in the body so it runs during parse, before the ground is painted. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: FRAME_GUARD }} />
        {/*
          The locale provider (#219) wraps everything the two scripts above do not own: one
          context for the whole tree, so the header's mute, the settings page and the match
          HUD read one catalogue and the chunk for a chosen locale is fetched once. It renders
          no element, so the exported markup is what it was. Its cost is the client reference
          it adds to every route payload, on the same 108x multiplier the frame notice below
          records — measured in `size-budget.json`'s `_rederived_2026_09_12_i18n`.

          The skip link's text is deliberately still a literal here rather than a `<T>`: a
          `<T>` in this file is serialised into all 108 prefetched play payloads, and
          `lib/i18n/T.tsx` says in its own header not to put one here. It is translated when
          #220 moves the link into a component of its own.
        */}
        <LocaleProvider>
          <a className="db-skip" href="#main">
            Skip to content
          </a>
          <div className="db-shell">
            <SiteHeader />
            {/*
            `tabIndex={-1}` is what makes the link above a skip link rather than a scroll.

            A fragment link moves the *viewport* to its target; it moves focus only if the
            target can hold focus, and a bare `<main>` cannot. Chromium papered over it by
            moving the sequential focus starting point, so the next Tab landed inside the
            page content and the link looked like it worked; WebKit was measured not to,
            and no screen reader's virtual cursor moved on either engine. So the first
            control on every page — the one control that exists for the people most likely
            to need it — did nothing for them.

            -1 rather than 0: this is a place focus is *put*, never a stop Tab visits on
            its way past. `globals.css` explains why it is also the one focusable thing on
            the site with no focus ring.
          */}
            <main id="main" className="db-main" tabIndex={-1}>
              {children}
            </main>
            <SiteFooter />
          </div>
          {/*
          The page's end of the service worker (#192 #193 #194), and the only client
          component this file mounts. Where it sits was decided rather than defaulted, so
          the three reasons are here rather than in a commit message nobody will find.

          **In the root layout at all**, because two of its three jobs are about the
          document and not about a route. It stamps `data-net` on `<html>`, which is what
          `globals.css` keys the offline catalogue annotations off; and a person who is
          offered a new build has to be offered it wherever they are standing, which is
          usually a game rather than the home page. Registered from one route instead, the
          worker would install for the visitors who happened to open that route and for
          nobody else — and every other route would go on being uncached while the site
          claimed otherwise. It is a `'use client'` component in the shell every visitor
          downloads, which is the cost; `ServiceWorkerBridge.tsx` is written to be small
          because of it, and `size-budget.json` is where that cost is argued.

          **A sibling of `.db-shell` rather than a child**, because the panel it can render
          is `position: fixed`, and a fixed element is positioned against the nearest
          ancestor carrying a `transform`, a `filter` or `contain` — not against the
          viewport. `.db-shell` is the element a page-entry animation or a future layout
          experiment reaches for first, and a bar nested inside it would then be laid out
          against the shell on whichever routes had grown one. Nothing carries a transform
          today — `db-page-in` animates opacity and sits on `.db-main`'s children — so this
          is not a bug being fixed. It is a place where being outside costs nothing and
          means nobody has to know this rule before adding one.

          **Last rather than first**, because the one control it can grow is a button, and
          the tab order of a page must not depend on the network. The skip link is the
          first stop on every route and stays the first stop; a bar that appears when the
          connection drops puts its Reload after the footer, where a control that arrived
          while you were reading belongs. On almost every load this renders `null` and is
          not in the document at all — which is also what keeps the site to a single
          `role="status"` region, an argument `ServiceWorkerBridge.tsx` sets out in full
          because two of them here would break `e2e/settings.spec.ts` and
          `e2e/record.spec.ts`, which both ask for the only one.
        */}
          {/*
          What a refused frame shows, and it is markup rather than script for two reasons.

          **Size (#2545).** Next serialises this whole tree into the `index.txt` route payload
          of every exported route, and `next/link` prefetches the payload of every catalogue
          card that comes near the viewport — so a browse that presses nothing fetches all 108
          of them. Bytes in the guard script above are therefore paid 108 times; bytes in
          `globals.css` are paid once. Everything about this notice that can live in a
          stylesheet does, and what is left here is the sentence and the link.

          **Hydration.** The script used to build this element and append it to `<body>` after
          `DOMContentLoaded`, which is the one part of the defence React could have clobbered
          on a mismatch. In the tree, React owns it.

          `href="."` rather than `location.href`: `trailingSlash: true` means every route is a
          directory, so `.` is this page — resolved by the browser, with no script and no
          origin to interpolate into markup. Hidden by `globals.css` until `<html>` carries
          `data-framed`, so it costs a normal visitor a `display: none` rule.

          **Last in the body, not first**, and that is a regression this had before it was
          moved. Rendered next to the scripts it belongs with, it became the first `a[href]`
          in the document, ahead of the skip link — `e2e/screen-reader.spec.ts` reads document
          order rather than tab order, and it is right to: the skip link is the first thing a
          keyboard or screen-reader user must meet, and "it is `display: none`, so a browser
          skips it" is an argument about focus that says nothing about a virtual cursor. It is
          `position: fixed; inset: 0` when it shows, so nothing about where it sits in the
          document affects where it is painted — and on a framed page everything above it is
          `visibility: hidden`, so its link is the only focusable thing left.
        */}
          <div id={FRAMED_NOTICE_ID}>
            {`${FRAMED_NOTICE_TEXT} `}
            <a href="." target="_blank" rel="noopener">
              {FRAMED_NOTICE_LINK}
            </a>
          </div>
          <ServiceWorkerBridge />
        </LocaleProvider>
      </body>
    </html>
  );
}
