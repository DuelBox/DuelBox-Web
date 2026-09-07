import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
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
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
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
