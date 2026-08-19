import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'DuelBox — 107 games for two players',
    template: '%s — DuelBox',
  },
  description:
    'A hundred and seven games for two people. Share one screen, play across two devices, ' +
    'or take on a bot. No download, no account.',
  applicationName: 'DuelBox',
  openGraph: {
    type: 'website',
    siteName: 'DuelBox',
    title: 'DuelBox — 107 games for two players',
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap"
        />
      </head>
      <body>
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
