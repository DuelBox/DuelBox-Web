import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { FRAME_GUARD } from './frame-guard';
import { SERVICE_WORKER_CLIENT } from './service-worker-client';
import { BASE_PATH } from './base-path';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'DuelBox — 108 games for two players',
    template: '%s — DuelBox',
  },
  description:
    'A hundred and seven games for two people. Share one screen, play across two devices, ' +
    'or take on a bot. No download, no account.',
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
    description: 'Share one screen, play across two devices, or take on a bot.',
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
 *
 * The one script in here is the frame guard, and it is inline and first for a reason: it is
 * the whole of the clickjacking defence on a host that serves no `X-Frame-Options` and no
 * CSP `frame-ancestors`, and a defence that waits for a chunk to download and React to
 * hydrate leaves a window in which the page is framed, painted and clickable. It costs no
 * JavaScript chunk at all — `emit-host-config.mjs` hashes it into each page's `script-src`
 * along with Next's own bootstrap, so the strict policy covers it without being widened.
 * See `frame-guard.ts` for what it does and does not buy.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <script dangerouslySetInnerHTML={{ __html: FRAME_GUARD }} />
        {/*
          Registration, the update prompt and the offline indicator, inline for the same two
          reasons the frame guard is: it costs the shell budget nothing, and it has to work
          in the conditions it exists for — no connection, possibly no hydration. See
          `service-worker-client.ts`.
        */}
        <script dangerouslySetInnerHTML={{ __html: SERVICE_WORKER_CLIENT }} />
        <a className="db-skip" href="#main">
          Skip to content
        </a>
        <div className="db-shell">
          <SiteHeader />
          <main id="main" className="db-main">
            {children}
          </main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
