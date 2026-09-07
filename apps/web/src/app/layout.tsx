import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { FRAME_GUARD } from './frame-guard';
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
 * some engines, and a theme script that throws would take the page down with it. */
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
      </body>
    </html>
  );
}
