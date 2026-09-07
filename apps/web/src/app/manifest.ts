import type { MetadataRoute } from 'next';

/**
 * The web app manifest (#73), so the site can be installed and shows its own mark and name
 * rather than a screenshot and a URL.
 *
 * Next generates this to `manifest.webmanifest` at build and adds the `<link rel="manifest">`
 * with the base path already on it. The icon `src` values, though, are plain strings Next
 * does not rewrite, so the base path is joined here — the same `NEXT_PUBLIC_BASE_PATH` the
 * config uses, read inside the function so it is picked up at generation time (and so it is
 * testable), empty for a root-served host and `/DuelBox-Web` on GitHub Pages. `start_url`
 * and `scope` carry it too, or an installed window would open at the origin root the project
 * page does not serve.
 *
 * The icons are SVG, which modern install surfaces accept at any size, so one file serves
 * every resolution: a full-bleed `any` icon for a square slot and a padded `maskable` one
 * whose mark sits inside the launcher's crop. The favicon and the apple-touch-icon are the
 * `icon.svg`/`apple-icon.svg` file conventions beside this file; sizes and the reasoning are
 * in `docs/brand-icons.md`.
 */

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return {
    name: 'DuelBox',
    short_name: 'DuelBox',
    description: 'A hundred and seven games for two people. No download, no account.',
    start_url: `${base}/`,
    scope: `${base}/`,
    display: 'standalone',
    orientation: 'any',
    background_color: '#f7f8fc',
    theme_color: '#4b3beb',
    icons: [
      {
        src: `${base}/manifest-icon.svg`,
        type: 'image/svg+xml',
        sizes: 'any',
        purpose: 'any',
      },
      {
        src: `${base}/manifest-icon-maskable.svg`,
        type: 'image/svg+xml',
        sizes: 'any',
        purpose: 'maskable',
      },
    ],
  };
}
