/**
 * The clickjacking posture of the site, and the allowlist the embeddable surface is built on
 * (#2367, CWE-1021).
 *
 * DuelBox deliberately ships one page other sites may frame — `/embed/[slug]` — and treats
 * every other page as un-frameable. On a host that serves response headers the enforcement is
 * a CSP `frame-ancestors` directive per route; this repository's static export is served today
 * by GitHub Pages, which serves none (#2481), so the same rule is also enforced in the page
 * itself. That is what this module is: the single source of the allowlist, the pure decision
 * a framed page makes about the origin that framed it, and the reader that pulls the facts
 * that decision needs out of a real `window`.
 *
 * Two postures fall out of one allowlist. The embed route is framed only by origins on the
 * list; every other route uses the empty list, which permits nobody — "no non-embed route can
 * be framed at all", the issue's third acceptance criterion. The list is compile-time: `'self'`
 * always, so the site can frame its own embed for a preview, plus whatever build config names
 * in `NEXT_PUBLIC_EMBED_ORIGINS`. A portal is added by rebuilding, not by a request, which is
 * the point of a static export having no runtime to ask.
 *
 * Nothing here reads `window` at module scope — the site is a static export evaluated on a
 * build machine with no DOM, and the decision runs inside an effect on the client. The reader
 * takes its `window` as an argument so it can be handed a fake and tested without one.
 */

/** In an allowlist, the token meaning "an ancestor whose origin equals this page's own". */
export const SELF_TOKEN = 'self';

/** The `frame-ancestors` value for every route that is not the embed: nobody may frame it. */
export const NON_EMBED_FRAME_ANCESTORS = "'none'";

/**
 * Parses an origin allowlist from build configuration.
 *
 * Comma- or whitespace-separated. `self` passes through as the token; everything else is run
 * through `URL` and kept only as a bare origin, so a trailing path or slash cannot smuggle in
 * a value that looks like one origin and matches another. An entry that is not a valid
 * absolute URL is dropped rather than trusted — a malformed allowlist entry is a
 * configuration mistake, and the safe reading of one is "not allowed".
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  const out: string[] = [];
  for (const piece of raw.split(/[\s,]+/)) {
    const token = piece.trim();
    if (token === '') continue;
    if (token === SELF_TOKEN) {
      if (!out.includes(SELF_TOKEN)) out.push(SELF_TOKEN);
      continue;
    }
    try {
      const { origin } = new URL(token);
      // `new URL('data:x')` and friends have the origin "null" as a string; a real remote
      // origin is a scheme and a host, so anything else is not one to allowlist.
      if (origin !== 'null' && !out.includes(origin)) out.push(origin);
    } catch {
      // Not an absolute URL, so not an origin. Dropped.
    }
  }
  return out;
}

/**
 * The compile-time allowlist for the embed surface: `'self'`, plus any origins named at build
 * time. Both the framing check and the `postMessage` check read from this one list, so the set
 * of origins that may frame the embed is exactly the set that may message it.
 */
export const EMBED_ALLOWED_ORIGINS: readonly string[] = [
  SELF_TOKEN,
  ...parseAllowedOrigins(process.env.NEXT_PUBLIC_EMBED_ORIGINS),
];

/** Resolves the `'self'` token in an allowlist to this page's own origin, dropping blanks. */
export function resolveAllowedOrigins(allowlist: readonly string[], selfOrigin: string): string[] {
  const out: string[] = [];
  for (const entry of allowlist) {
    const origin = entry === SELF_TOKEN ? selfOrigin : entry;
    if (origin !== '' && !out.includes(origin)) out.push(origin);
  }
  return out;
}

/** Whether `origin` is permitted by `allowlist`, with `'self'` read against `selfOrigin`. */
export function isAllowedEmbedder(
  origin: string,
  allowlist: readonly string[],
  selfOrigin: string,
): boolean {
  return resolveAllowedOrigins(allowlist, selfOrigin).includes(origin);
}

/**
 * The CSP `frame-ancestors` value an allowlist describes, for the header/meta emitter.
 *
 * An empty list is `'none'`; otherwise `'self'` stays the CSP keyword and every other entry is
 * a bare origin. This is the string a headers-serving host would put on the embed route, and
 * the report for `scripts/emit-host-config.mjs` names it — the enforcement below is the
 * fallback for the host that serves no headers, not a replacement for it.
 */
export function frameAncestorsDirective(allowlist: readonly string[]): string {
  const parts = allowlist
    .map((entry) => (entry === SELF_TOKEN ? "'self'" : entry))
    .filter((entry) => entry !== '');
  return parts.length === 0 ? "'none'" : parts.join(' ');
}

/* ----------------------------------------------------------------- reading a window ---- */

/** The shape of `location.ancestorOrigins`, which WebKit and Chromium have and Firefox lacks. */
export interface AncestorOrigins {
  readonly length: number;
  item?(index: number): string | null;
  readonly [index: number]: string | undefined;
}

/** Just the parts of `window`/`location`/`document` the reader needs, so a test can fake it. */
export interface FrameWindow {
  readonly self: unknown;
  readonly top: unknown;
  readonly location: { readonly origin: string; readonly ancestorOrigins?: AncestorOrigins };
  readonly document?: { readonly referrer?: string };
}

/** The origin of the frame immediately containing this one, or null if it cannot be known. */
export function ancestorOrigin(win: FrameWindow): string | null {
  const origins = win.location.ancestorOrigins;
  if (origins !== undefined && origins.length > 0) {
    // Index 0 is the immediate parent — the origin that framed us.
    const first = origins.item ? origins.item(0) : origins[0];
    if (typeof first === 'string' && first !== '') return first;
  }
  // Firefox has no `ancestorOrigins`; the referrer is the parent document's URL on a first
  // navigation into the frame. Parsed to an origin so a path cannot masquerade as one.
  const referrer = win.document?.referrer;
  if (typeof referrer === 'string' && referrer !== '') {
    try {
      const { origin } = new URL(referrer);
      if (origin !== 'null') return origin;
    } catch {
      // Not a URL; fall through.
    }
  }
  return null;
}

/** What a framed page needs to know about its situation, read from a real (or fake) window. */
export interface FrameContext {
  readonly framed: boolean;
  readonly ancestorOrigin: string | null;
  readonly selfOrigin: string;
}

export function readFrameContext(win: FrameWindow): FrameContext {
  const framed = win.top !== win.self;
  return {
    framed,
    ancestorOrigin: framed ? ancestorOrigin(win) : null,
    selfOrigin: win.location.origin,
  };
}

/* --------------------------------------------------------------------- the decision ---- */

export interface FrameGuardResult {
  readonly framed: boolean;
  readonly ancestorOrigin: string | null;
  /** True when the page is allowed to render where it is: not framed, or framed by an ally. */
  readonly allowed: boolean;
  readonly reason: string;
}

/**
 * Decides whether a page may render in the frame it finds itself in.
 *
 * A page that is not framed always may — this is not a rule against being a top-level page. A
 * framed page may only when the origin that framed it is on the allowlist; an origin that
 * cannot even be determined is refused, because "I could not tell who framed me" is not a
 * reason to trust them. The embed route passes {@link EMBED_ALLOWED_ORIGINS}; every other
 * route passes the empty list, for which no framed page is ever allowed.
 */
export function evaluateFrameGuard(input: {
  readonly framed: boolean;
  readonly ancestorOrigin: string | null;
  readonly allowlist: readonly string[];
  readonly selfOrigin: string;
}): FrameGuardResult {
  const { framed, ancestorOrigin: ancestor, allowlist, selfOrigin } = input;
  if (!framed) {
    return { framed, ancestorOrigin: null, allowed: true, reason: 'not framed' };
  }
  if (ancestor === null) {
    return {
      framed,
      ancestorOrigin: null,
      allowed: false,
      reason: 'the framing ancestor origin could not be determined',
    };
  }
  if (isAllowedEmbedder(ancestor, allowlist, selfOrigin)) {
    return {
      framed,
      ancestorOrigin: ancestor,
      allowed: true,
      reason: `${ancestor} is allowlisted`,
    };
  }
  return {
    framed,
    ancestorOrigin: ancestor,
    allowed: false,
    reason: `${ancestor} is not on the embed allowlist`,
  };
}

/**
 * The whole guard for a real window: read the context, then decide.
 *
 * Returns a decision rather than acting on the DOM, so the caller — a React effect — chooses
 * what a refusal looks like (the embed renders a link out to the game instead of the board).
 * Keeping the action out of here is what lets every branch above be tested without a DOM.
 */
export function checkFrame(win: FrameWindow, allowlist: readonly string[]): FrameGuardResult {
  const context = readFrameContext(win);
  return evaluateFrameGuard({
    framed: context.framed,
    ancestorOrigin: context.ancestorOrigin,
    allowlist,
    selfOrigin: context.selfOrigin,
  });
}

/**
 * The synchronous, header-free clickjacking defence injected inline into every page by
 * `app/layout.tsx`. On a host that serves no response headers (GitHub Pages, #2481), this is
 * what actually stops another site framing a DuelBox page: the first line hides `<html>`
 * during parse, before anything paints, and the notice is attached once the body exists.
 *
 * It ships in each page's markup rather than a bundled chunk, so it is written terse and its
 * reasoning lives in the block comment on the WIP-side history rather than here.
 *
 * The one exemption is the embed route (#2367): `/embed/<slug>/` is the single surface a
 * framed page is *meant* to be, so the buster returns early there and lets `EmbedFrame`'s own
 * best-effort origin allowlist (`checkFrame` / `EMBED_ALLOWED_ORIGINS` above) decide whether
 * to show the game or a "open in a new tab" backlink. That is the "path allowlist" the WIP
 * comment always said the exemption would be — an origin allowlist means nothing to a framed
 * page, which cannot read its embedder's origin; only a response-header `frame-ancestors`
 * (which this host does not serve) is a real boundary, so the embed's in-page check is a
 * best-effort courtesy, not a security control.
 */
export const FRAME_GUARD = [
  '(function(){var w=window;if(w.top===w.self)return;',
  'if(w.location.pathname.indexOf("/embed/")!==-1)return;',
  'var d=w.document,s=d.createElement("style");',
  's.textContent="html{visibility:hidden!important}#db-framed{visibility:visible!important;',
  'position:fixed;inset:0;background:#fff;color:#111;font:1rem/1.5 system-ui,sans-serif;padding:2rem}";',
  '(d.head||d.documentElement).appendChild(s);',
  'd.addEventListener("DOMContentLoaded",function(){',
  'var n=d.createElement("div");n.id="db-framed";',
  'var a=d.createElement("a");a.href=w.location.href;a.target="_blank";a.rel="noopener";',
  'a.textContent="Open DuelBox in a new tab";',
  'n.append("DuelBox does not run inside a frame. ",a);d.body.appendChild(n)})})()',
].join('');
