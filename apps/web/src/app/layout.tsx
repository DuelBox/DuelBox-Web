import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { SITE_SHARE_IMAGE } from '@/lib/share-image';
import { SITE_URL } from '@/lib/site';
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
  description:
    'A hundred and seven games for two people. Share one screen, play across two devices, ' +
    'or take on a bot. No download, no account.',
  applicationName: 'DuelBox',
  openGraph: {
    type: 'website',
    siteName: 'DuelBox',
    title: 'DuelBox — 108 games for two players',
    description: 'Share one screen, play across two devices, or take on a bot.',
    // The card every route inherits unless it names its own (#2453). A route that sets its
    // own `openGraph` replaces this object rather than merging with it, which is why the
    // two that do — a game's page and a category hub — each carry `images` of their own.
    images: [SITE_SHARE_IMAGE],
  },
  twitter: {
    card: 'summary',
    title: 'DuelBox — 108 games for two players',
    description: 'Share one screen, play across two devices, or take on a bot.',
    images: [SITE_SHARE_IMAGE],
  },
};

export const viewport: Viewport = {
  themeColor: '#4b3beb',
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
