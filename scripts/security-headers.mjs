/**
 * The response headers the origin must send, in one place.
 *
 * A static export has no server runtime, so headers are the host's job — and every host
 * spells them differently. Writing them out three times, in three formats, by hand is how
 * a site ends up with HSTS on Netlify and not on Cloudflare, and nobody finds out until a
 * scanner does. This module is the single source; `emit-host-config.mjs` renders it into
 * whatever each host reads, and `check-headers.mjs` fails the build if one is dropped.
 *
 * Each entry says what it protects. A header nobody can justify is a header that gets
 * deleted the first time it breaks something.
 */

/**
 * `Content-Security-Policy` is assembled separately, because on a static export its
 * script-src cannot be written by hand — see `emit-host-config.mjs`.
 */
export const SECURITY_HEADERS = Object.freeze({
  /**
   * Two years, subdomains included, preload-eligible.
   *
   * The one header here that is dangerous to get wrong: once a browser has seen it, it
   * will refuse plain HTTP to this host for two years whatever we serve afterwards. That
   * is the point, and it is also why `includeSubDomains` is a decision rather than a
   * default — every present and future subdomain must be able to do TLS.
   */
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',

  /**
   * Stops a browser guessing that a `.json` is really HTML and running it.
   *
   * Cheap, and it closes the whole family of attacks that begin with a file being served
   * as one type and interpreted as another.
   */
  'X-Content-Type-Options': 'nosniff',

  /**
   * Send the origin cross-site, the full path same-origin.
   *
   * There is nothing sensitive in a URL here — a game slug is not a secret — but a
   * referrer is the kind of thing that becomes sensitive later without anybody revisiting
   * the header.
   */
  'Referrer-Policy': 'strict-origin-when-cross-origin',

  /**
   * Every capability off, explicitly, because this game needs none of them.
   *
   * A two-player game on one device wants a canvas, a keyboard and a touchscreen. It does
   * not want a camera, a microphone, a location, a payment sheet, or a USB device, and
   * saying so out loud means a dependency that starts asking for one fails visibly rather
   * than prompting a player.
   */
  'Permissions-Policy': [
    'accelerometer=()',
    'ambient-light-sensor=()',
    'autoplay=()',
    'browsing-topics=()',
    'camera=()',
    'display-capture=()',
    'encrypted-media=()',
    'geolocation=()',
    'gyroscope=()',
    'hid=()',
    'idle-detection=()',
    'interest-cohort=()',
    'local-fonts=()',
    'magnetometer=()',
    'microphone=()',
    'midi=()',
    'payment=()',
    'publickey-credentials-get=()',
    'screen-wake-lock=(self)',
    'serial=()',
    'usb=()',
    'xr-spatial-tracking=()',
  ].join(', '),

  /**
   * Cross-origin isolation.
   *
   * `same-origin` on the opener policy severs `window.opener` for anything we link out to,
   * which is what stops a linked page navigating the tab it came from. Together with the
   * embedder policy these are also the precondition for `SharedArrayBuffer`, which a
   * future WebGL or WASM renderer would want and which cannot be switched on retroactively
   * without breaking every embed at once.
   */
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',

  /**
   * `credentialless` rather than `require-corp`.
   *
   * `require-corp` would refuse any cross-origin subresource that does not opt in, and the
   * embeddable-iframe work (#2367) needs third-party pages to be able to host us.
   * `credentialless` gets the isolation without demanding that every embedder change.
   */
  'Cross-Origin-Embedder-Policy': 'credentialless',

  /**
   * Legacy, and kept deliberately.
   *
   * Modern browsers ignore `X-Frame-Options` in favour of CSP `frame-ancestors`, which we
   * also set. It costs one line and it is still read by the older browsers that are
   * exactly the ones without `frame-ancestors`.
   */
  'X-Frame-Options': 'SAMEORIGIN',
});

/**
 * The CSP directives that do not depend on what the build produced.
 *
 * `script-src` is absent on purpose: it carries per-build hashes and is completed by
 * `emit-host-config.mjs`.
 */
export const CSP_STATIC_DIRECTIVES = Object.freeze({
  'default-src': "'none'",
  /** No remote fonts, no analytics beacons, no CDN. Everything is served from here. */
  'connect-src': "'self'",
  'img-src': "'self' data:",
  'font-src': "'self'",
  'media-src': "'self'",
  'manifest-src': "'self'",
  'worker-src': "'self'",
  /**
   * Next's static export inlines its route styles, so `'unsafe-inline'` is unavoidable for
   * styles and only for styles. It is worth naming the difference: an inline *style* can
   * restyle a page, and an inline *script* can do anything, which is why `script-src`
   * below is hashed rather than given the same escape.
   */
  'style-src': "'self' 'unsafe-inline'",
  'base-uri': "'none'",
  'form-action': "'none'",
  'frame-ancestors': "'self'",
  'object-src': "'none'",
  'upgrade-insecure-requests': '',
});

/** Header order is not meaningful; sorted so two renderings of the same set match. */
export function headerEntries(csp) {
  const all = { ...SECURITY_HEADERS };
  if (csp) all['Content-Security-Policy'] = csp;
  return Object.entries(all).sort(([a], [b]) => a.localeCompare(b));
}
