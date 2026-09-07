import type { MetadataRoute } from 'next';
import { BASE_PATH } from './base-path';

/**
 * The web app manifest — what a phone reads when somebody keeps DuelBox on their home
 * screen.
 *
 * `manifest-src 'self'` has been in the content security policy since it was written and
 * had nothing to allow, which is the same shape of gap as `worker-src` next to it: a policy
 * permitting a file that did not exist. This is the file.
 *
 * ## `display: 'standalone'`, not `fullscreen`
 *
 * Two people share one device here, and the thing they share most often is a phone. A
 * fullscreen app takes the system back gesture away from whoever is holding it, and the
 * shell's own way out of a match is the pause menu — which needs a person to reach the
 * corner of a screen the other player is also touching. Standalone keeps the platform's
 * navigation where people expect it and loses nothing: the play route already fills the
 * viewport and hides the site footer.
 *
 * ## Orientation is not locked
 *
 * Deliberately. Rule "correct from 320px to 4K in both orientations" is in the definition
 * of done, two seats read a shared screen differently in portrait than in landscape, and a
 * manifest that pinned one would override the choice the two players just made by turning
 * the device.
 *
 * ## Icons
 *
 * `any` and `maskable` are two different drawings, not one file labelled twice. A maskable
 * icon is cropped to a platform-chosen shape, so it fills its square and keeps everything
 * inside the safe circle; the plain icon keeps the wordmark's rounded corners. Declaring
 * one file as both is the common mistake and it produces either a clipped mark or a small
 * one floating in a big coloured field. `scripts/make-icons.mjs` draws both.
 *
 * ## Shortcuts
 *
 * Routes, not games. A shortcut to one game would be a guess about which of a hundred and
 * eight a particular pair plays, made once at install time and wrong for almost everybody;
 * the catalogue and the two-minute filter are useful to every pair. All three are precached
 * by the service worker, so a shortcut still works with no connection — a shortcut that
 * opens an error page is worse than no shortcut.
 */
/**
 * A metadata route is a route handler, and `output: 'export'` refuses to emit one unless it
 * says out loud that it is static — the build fails with the URL in the message rather than
 * shipping a manifest that needs a server. This is the opposite of the setting
 * `scripts/check-zero-cost.mjs` fails on (`force-dynamic`), and it is the same promise stated
 * from the other side: rendered once, at build time, into a file.
 */
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'DuelBox — games for two players',
    short_name: 'DuelBox',
    description:
      'A hundred and eight games for two people. Share one screen or take on a bot. ' +
      'No account, no download, and it keeps working with no connection.',
    id: `${BASE_PATH}/`,
    start_url: `${BASE_PATH}/`,
    scope: `${BASE_PATH}/`,
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#4b3beb',
    categories: ['games', 'entertainment'],
    lang: 'en',
    dir: 'ltr',
    icons: [
      {
        src: `${BASE_PATH}/icons/icon.svg`,
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: `${BASE_PATH}/icons/icon-192.png`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `${BASE_PATH}/icons/icon-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `${BASE_PATH}/icons/maskable-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'All games',
        short_name: 'Games',
        description: 'Browse every game by category, length and mode.',
        url: `${BASE_PATH}/games/`,
        icons: [{ src: `${BASE_PATH}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'How to play',
        short_name: 'How to',
        description: 'Seats, controls and what the two of you each do.',
        url: `${BASE_PATH}/how-to-play/`,
        icons: [{ src: `${BASE_PATH}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
