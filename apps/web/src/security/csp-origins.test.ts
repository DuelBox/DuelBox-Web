/**
 * The policy must permit every origin the site actually loads from.
 *
 * Issue #2469: `layout.tsx` linked a stylesheet from `fonts.googleapis.com`, which pulled
 * font files from `fonts.gstatic.com`, while `scripts/security-headers.mjs` said
 * `style-src 'self' 'unsafe-inline'` and `font-src 'self'`. Both halves were refused. The
 * site rendered anyway — in whatever face each device happens to default to — so nothing
 * looked broken, no test failed, and it shipped. That is the shape of the failure worth
 * guarding: a CSP does not error, it silently drops a subresource.
 *
 * So this is not a font test. It reads the policy out of `security-headers.mjs`, walks the
 * markup and stylesheets for every position that *loads* something — a `<link>`, a
 * `<script src>`, an `@import`, a `url()` — and asserts the directive governing each one
 * permits the origin it names. Add a CDN, an analytics beacon, an embedded map or a remote
 * image tomorrow and this fails before the browser gets a chance to drop it quietly.
 *
 * Both the source and, when it exists, the built export are scanned. The source scan is the
 * one that catches a mistake before a build; the `out/` scan is the one that catches
 * something a dependency injected into the emitted HTML that no source file mentions.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSP_STATIC_DIRECTIVES } from '../../../../scripts/security-headers.mjs';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const SOURCE = join(ROOT, 'apps/web/src');
const EXPORT = join(ROOT, 'apps/web/out');

/* ------------------------------------------------------------------ the policy ---- */

/**
 * What a directive falls back to when the policy does not name it.
 *
 * CSP's own fallback chain. Getting this wrong in the permissive direction would make the
 * guard useless, so it is spelled out rather than assumed: anything not listed falls back
 * to `default-src`, which here is `'none'`.
 */
const FALLBACK: Readonly<Record<string, string>> = {
  'frame-src': 'child-src',
  'child-src': 'default-src',
  'worker-src': 'child-src',
};

/**
 * `script-src` is deliberately absent from `CSP_STATIC_DIRECTIVES` — `emit-host-config.mjs`
 * completes it per page with the SHA-256 of each inline script, on top of `'self'`. A hash
 * permits no origin, so from where this guard stands the effective source list is `'self'`
 * and that is what it checks against.
 */
const SCRIPT_SRC = "'self'";

function sourcesFor(directive: string): string[] {
  if (directive === 'script-src') return [SCRIPT_SRC];
  const directives: Readonly<Record<string, string>> = CSP_STATIC_DIRECTIVES;
  const value = directives[directive];
  if (value === undefined) {
    const fallback = FALLBACK[directive] ?? 'default-src';
    // `default-src` is always present; the guard against a missing one is the empty list,
    // which permits nothing — the safe direction to be wrong in.
    return fallback === directive ? [] : sourcesFor(fallback);
  }
  return value.split(/\s+/).filter(Boolean);
}

/** Every directive that can permit a remote origin at all, for the preconnect check. */
const FETCH_DIRECTIVES = [
  'connect-src',
  'font-src',
  'img-src',
  'media-src',
  'manifest-src',
  'script-src',
  'style-src',
  'worker-src',
  'frame-src',
];

/**
 * Does one CSP source expression permit this origin?
 *
 * Only the forms that can name a remote origin are handled: `*`, a bare scheme, and a host
 * expression with optional scheme, wildcard label and port. Keywords (`'self'`, `'none'`,
 * `'unsafe-inline'`, a hash) never match a remote origin, which is the whole point.
 */
function expressionPermits(expression: string, origin: URL): boolean {
  if (expression === '*') return true;
  if (expression.startsWith("'")) return false;
  if (/^[a-z][a-z0-9+.-]*:$/i.test(expression)) {
    return expression.toLowerCase() === origin.protocol;
  }

  const parsed = /^(?:([a-z][a-z0-9+.-]*):\/\/)?([^/:]+)(?::(\d+|\*))?/i.exec(expression);
  if (parsed === null) return false;
  const [, scheme, host, port] = parsed;
  if (host === undefined) return false;
  if (scheme !== undefined && `${scheme.toLowerCase()}:` !== origin.protocol) return false;
  // A URL object leaves `port` empty on the scheme's default, so `https://x:443` and
  // `https://x` are the same origin and the expression must match both.
  const actualPort = origin.port !== '' ? origin.port : origin.protocol === 'http:' ? '80' : '443';
  if (port !== undefined && port !== '*' && port !== actualPort) return false;

  const wanted = host.toLowerCase();
  const actual = origin.hostname.toLowerCase();
  if (wanted.startsWith('*.'))
    return actual.endsWith(wanted.slice(1)) && actual !== wanted.slice(2);
  return wanted === actual;
}

function permits(directive: string, origin: URL): boolean {
  return sourcesFor(directive).some((expression) => expressionPermits(expression, origin));
}

/* --------------------------------------------------------------- the references ---- */

interface Reference {
  /** File it was found in, relative to the repository root. */
  where: string;
  /** The origin, normalised: `https://fonts.googleapis.com`. */
  origin: string;
  /**
   * The directive that governs it, or `'connect'` for a `preconnect`, which CSP does not
   * govern but which always precedes something that it does.
   */
  directive: string;
  /** What pointed at it, for a failure message somebody can act on. */
  detail: string;
}

/** Attributes that make the browser fetch something, per element. */
const SUBRESOURCE_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  link: ['href'],
  script: ['src'],
  img: ['src', 'srcset'],
  image: ['href', 'xlink:href'],
  iframe: ['src'],
  frame: ['src'],
  audio: ['src'],
  video: ['src', 'poster'],
  source: ['src', 'srcset'],
  track: ['src'],
  embed: ['src'],
  object: ['data'],
  form: ['action'],
  use: ['href', 'xlink:href'],
};

const TAG_DIRECTIVE: Readonly<Record<string, string>> = {
  script: 'script-src',
  img: 'img-src',
  image: 'img-src',
  use: 'default-src',
  iframe: 'frame-src',
  frame: 'frame-src',
  audio: 'media-src',
  video: 'media-src',
  source: 'media-src',
  track: 'media-src',
  embed: 'object-src',
  object: 'object-src',
  form: 'form-action',
};

/** `<link rel>` decides everything about a link, so it gets its own table. */
const LINK_REL_DIRECTIVE: Readonly<Record<string, string>> = {
  stylesheet: 'style-src',
  manifest: 'manifest-src',
  icon: 'img-src',
  'shortcut icon': 'img-src',
  'apple-touch-icon': 'img-src',
  'mask-icon': 'img-src',
  preconnect: 'connect',
  'dns-prefetch': 'connect',
};

/** `<link rel="preload" as="…">` decides for itself. */
const LINK_AS_DIRECTIVE: Readonly<Record<string, string>> = {
  font: 'font-src',
  style: 'style-src',
  script: 'script-src',
  image: 'img-src',
  audio: 'media-src',
  video: 'media-src',
  track: 'media-src',
  fetch: 'connect-src',
  document: 'frame-src',
  worker: 'worker-src',
};

/** `//example.com/x` inherits the page's scheme; treat it as https, which it will be. */
function originOf(value: string): string | null {
  const url = value.trim().split(/[\s,]/)[0] ?? '';
  const absolute = url.startsWith('//') ? `https:${url}` : url;
  if (!/^https?:\/\//i.test(absolute)) return null;
  try {
    return new URL(absolute).origin;
  } catch {
    return null;
  }
}

function attributesOf(raw: string): Record<string, string> {
  const found: Record<string, string> = {};
  // Quoted HTML attributes and the JSX `{'…'}` form. Anything more exotic than that is not
  // how a subresource URL gets written, and a missed one shows up in the `out/` scan.
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*['"`]([^'"`]*)['"`]\s*\})/g;
  for (const match of raw.matchAll(pattern)) {
    const name = match[1]?.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4];
    if (name !== undefined && value !== undefined) found[name] = value;
  }
  return found;
}

function linkDirective(attributes: Record<string, string>): string {
  const rel = (attributes['rel'] ?? '').toLowerCase().trim();
  if (rel === 'preload' || rel === 'prefetch' || rel === 'modulepreload') {
    const as = (attributes['as'] ?? '').toLowerCase();
    return LINK_AS_DIRECTIVE[as] ?? (rel === 'modulepreload' ? 'script-src' : 'default-src');
  }
  // `canonical`, `alternate`, `author`, `me`, `license` and friends are metadata or
  // navigation. Nothing is fetched, so no directive governs them.
  return LINK_REL_DIRECTIVE[rel] ?? '';
}

/**
 * Markup — HTML or the JSX that produces it.
 *
 * Comments are stripped first, and script bodies emptied. This file and `layout.tsx` both
 * *discuss* `fonts.googleapis.com` at length now, and a guard that fires on prose is a
 * guard somebody deletes.
 *
 * Line comments are stripped only when the `//` opens the line: the obvious pattern
 * `/\/\/.*$/` also eats `href="//cdn.example.com/x"`, and a protocol-relative subresource
 * is exactly the kind of thing this must not become blind to.
 */
function scanMarkup(text: string, where: string): Reference[] {
  const stripped = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>');

  const references: Reference[] = [];
  for (const match of stripped.matchAll(/<([a-zA-Z][\w:-]*)\b([^>]*)>/g)) {
    const tag = match[1]?.toLowerCase();
    const raw = match[2] ?? '';
    if (tag === undefined) continue;
    const wanted = SUBRESOURCE_ATTRIBUTES[tag];
    if (wanted === undefined) continue;

    const attributes = attributesOf(raw);
    for (const name of wanted) {
      const value = attributes[name];
      if (value === undefined) continue;
      const origin = originOf(value);
      if (origin === null) continue;
      const directive = tag === 'link' ? linkDirective(attributes) : (TAG_DIRECTIVE[tag] ?? '');
      if (directive === '') continue;
      references.push({
        where,
        origin,
        directive,
        detail: `<${tag} ${name}="${value.slice(0, 96)}">`,
      });
    }
  }
  return references;
}

/**
 * Stylesheets — `@import` pulls another stylesheet, `url()` inside `@font-face` pulls a
 * font, and everything else `url()` reaches for is an image as far as CSP is concerned.
 */
function scanCss(text: string, where: string): Reference[] {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const references: Reference[] = [];

  const add = (value: string, directive: string, detail: string) => {
    const origin = originOf(value);
    if (origin !== null) references.push({ where, origin, directive, detail });
  };

  for (const match of stripped.matchAll(/@import\s+(?:url\(\s*)?['"]?([^'")\s]+)/g)) {
    add(match[1] ?? '', 'style-src', `@import ${match[1] ?? ''}`);
  }

  // Which `url()`s belong to an `@font-face` — by block, so a background image in the rule
  // next door is not mistaken for a font.
  const fontFaceRanges: Array<[number, number]> = [];
  for (const match of stripped.matchAll(/@font-face\s*\{[^}]*\}/g)) {
    fontFaceRanges.push([match.index, match.index + match[0].length]);
  }
  const inFontFace = (index: number) =>
    fontFaceRanges.some(([start, end]) => index >= start && index < end);

  for (const match of stripped.matchAll(/url\(\s*['"]?([^'")]+)/g)) {
    const value = match[1] ?? '';
    add(value, inFontFace(match.index) ? 'font-src' : 'img-src', `url(${value.slice(0, 96)})`);
  }
  return references;
}

/* ---------------------------------------------------------------------- the walk ---- */

function walk(dir: string, extensions: ReadonlySet<string>): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full, extensions));
    else if (extensions.has(extname(full).toLowerCase())) found.push(full);
  }
  return found;
}

function scanFile(path: string): Reference[] {
  const where = relative(ROOT, path);
  const text = readFileSync(path, 'utf8');
  return extname(path).toLowerCase() === '.css' ? scanCss(text, where) : scanMarkup(text, where);
}

/** Tests are not shipped, and this one is full of deliberately forbidden origins. */
const sourceFiles = walk(SOURCE, new Set(['.tsx', '.ts', '.css'])).filter(
  (path) => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx'),
);
const exportedFiles = walk(EXPORT, new Set(['.html', '.css']));

/**
 * Every reference the policy would refuse, one message per distinct mistake.
 *
 * Grouped rather than listed: the export is a hundred and fifty pages off one layout, so an
 * ungrouped run of this reported the same three tags six hundred times and the actual
 * problem scrolled off the top. One line per mistake, with a file to look at and a count.
 */
function violations(references: readonly Reference[]): string[] {
  const grouped = new Map<string, { message: string; files: Set<string> }>();
  for (const reference of references) {
    const origin = new URL(reference.origin);
    const allowed =
      reference.directive === 'connect'
        ? FETCH_DIRECTIVES.some((directive) => permits(directive, origin))
        : permits(reference.directive, origin);
    if (allowed) continue;

    const message =
      reference.directive === 'connect'
        ? `${reference.detail} opens a connection to ${reference.origin}, which no directive ` +
          'in the policy permits'
        : `${reference.detail} needs ${reference.origin} in ${reference.directive}, ` +
          `which is "${sourcesFor(reference.directive).join(' ')}"`;
    const existing = grouped.get(message);
    if (existing === undefined)
      grouped.set(message, { message, files: new Set([reference.where]) });
    else existing.files.add(reference.where);
  }

  return [...grouped.values()].map(({ message, files }) => {
    const [first = '?'] = [...files].sort();
    const others = files.size - 1;
    return `${message} — ${first}${others > 0 ? ` and ${String(others)} other file(s)` : ''}`;
  });
}

/* --------------------------------------------------------------------- the tests ---- */

describe('the CSP permits every origin the site loads from', () => {
  it('has files to look at, so a green run means something', () => {
    expect(sourceFiles.length).toBeGreaterThan(10);
  });

  it('finds no source reference to an origin the policy would refuse', () => {
    expect(violations(sourceFiles.flatMap(scanFile))).toEqual([]);
  });

  it('finds no reference in the built export to an origin the policy would refuse', () => {
    if (exportedFiles.length === 0) {
      // `pnpm test` runs before `pnpm build` in the gate, so there is usually nothing here.
      // The source scan above is the guard that runs on every push; this one adds anything
      // a dependency injected into the emitted HTML that no source file mentions.
      expect(exportedFiles).toEqual([]);
      return;
    }
    expect(violations(exportedFiles.flatMap(scanFile))).toEqual([]);
  });

  it('agrees with the policy it was written against', () => {
    // If any of these three change, the guard above changes meaning, and that should be a
    // deliberate edit rather than a surprise.
    expect(CSP_STATIC_DIRECTIVES['default-src']).toBe("'none'");
    expect(CSP_STATIC_DIRECTIVES['font-src']).toBe("'self'");
    expect(CSP_STATIC_DIRECTIVES['style-src']).toBe("'self' 'unsafe-inline'");
  });
});

/**
 * The threat model's inventory of third parties, held against the origins the site loads.
 *
 * Section 6 went on saying "We fetch three typefaces from Google's CDN on every cold load"
 * and "**Not mitigated.** #187 covers self-hosting them" for as long as it did because a
 * document is not a test. #2469 had self-hosted the faces, this file had been written to
 * fail the build if they came back, `e2e/fonts.spec.ts` was asserting on a real cold load
 * that nothing goes to Google — and the one document whose job is the honest inventory of
 * live risk told a reader we had a third-party runtime dependency we do not have. A threat
 * model that overstates is not the safe direction to be wrong in: it spends the reader's
 * attention on a risk that is closed and teaches them the section is decorative.
 *
 * So the verdict is computed. If the source loads from nowhere but this origin, section 6
 * may not carry a "not mitigated" verdict; if it loads from somewhere, section 6 has to
 * name it. Both halves fail loudly, and exactly one of them runs — the shape
 * `offline-claims.test.ts` established for the same class of failure.
 */
const remoteOrigins = [...new Set(sourceFiles.flatMap(scanFile).map((r) => r.origin))].sort();

/** A live claim that something is fetched from somebody else's server. */
const FETCHES_REMOTELY = /\b(?:we|the site) (?:fetch|fetches|load|loads|pull|pulls)\b[^.]*\bCDN\b/i;

/**
 * A sentence recording that a claim was *removed*, which is the opposite of making it.
 *
 * `offline-claims.test.ts` earned this rule the same way: a file that says "this used to say
 * X" was failed as though it were saying X, and telling somebody to reword an accurate
 * history is how a team learns to route around a guard.
 */
const REMEMBERED = /\bused to\b|\bno longer\b|\buntil\b.*#\d|\bwas removed\b/i;

const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+/);

/** Section 6, from its heading to the next one. */
function thirdPartySection(): string {
  const model = readFileSync(join(ROOT, 'docs/threat-model.md'), 'utf8');
  const start = model.search(/^#{2,3} .*third[- ]party/im);
  if (start === -1) {
    throw new Error(
      'docs/threat-model.md no longer has a third-party section, so this cannot hold its' +
        ' verdict against what the site loads. Point it at whatever replaced it.',
    );
  }
  const rest = model.slice(start);
  // The next heading of the same rank or higher, found from the newline that opens it so
  // that this section's own heading is not what stops the slice.
  const next = rest.search(/\n#{2,3} /);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('what the threat model says about third parties', () => {
  it.skipIf(remoteOrigins.length > 0)('does not report a dependency that is not there', () => {
    const section = thirdPartySection();
    expect(
      section.match(/\*\*Not mitigated[^*]*\*\*/i)?.[0] ?? null,
      'nothing in apps/web/src loads from another origin — the typefaces are files in this' +
        ' repository and the CSP was never widened — so this section may not stand as an open' +
        ' risk. Say what landed, and which guard keeps it landed.',
    ).toBeNull();
    const live = sentences(section).filter(
      (sentence) => FETCHES_REMOTELY.test(sentence) && !REMEMBERED.test(sentence),
    );
    expect(
      live,
      'this says the site fetches something from a CDN. It fetches nothing from anywhere but' +
        ' this origin.',
    ).toEqual([]);
  });

  it.runIf(remoteOrigins.length > 0)('names every origin the site now reaches', () => {
    const section = thirdPartySection();
    const unnamed = remoteOrigins.filter((origin) => !section.includes(new URL(origin).hostname));
    expect(
      unnamed,
      `the site loads from ${remoteOrigins.join(', ')} and the threat model does not name` +
        ' these. A third party the model does not list is a risk nobody weighed.',
    ).toEqual([]);
  });

  it('can find the section, and can tell a verdict from a paragraph', () => {
    // Which half runs is decided by a scan, and a scan that quietly stopped finding anything
    // would skip one and pass the other on an empty string.
    const section = thirdPartySection();
    expect(section).toMatch(/third[- ]party/i);
    expect(section, 'the slice ran to the end of the document').not.toContain(
      'What the architecture removes',
    );
    expect('**Not mitigated.** #187 covers self-hosting them.').toMatch(
      /\*\*Not mitigated[^*]*\*\*/i,
    );
    expect(
      FETCHES_REMOTELY.test("We fetch three typefaces from Google's CDN on every cold load."),
    ).toBe(true);
    // And the use-and-mention half: the sentence that records the deletion is not the claim.
    expect(
      REMEMBERED.test("This section used to say we fetch three typefaces from Google's CDN."),
    ).toBe(true);
    expect(REMEMBERED.test("We fetch three typefaces from Google's CDN on every cold load.")).toBe(
      false,
    );
  });
});

describe('the guard itself', () => {
  /** Exactly what `layout.tsx` carried before #2469, minus the excuses. */
  const beforeTheFix = `
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&display=swap"
        />
      </head>
    </html>`;

  it('would have caught #2469 — all three tags, not just the stylesheet', () => {
    const failures = violations(scanMarkup(beforeTheFix, 'layout.tsx'));
    expect(failures).toHaveLength(3);
    expect(failures.join('\n')).toContain('style-src');
    expect(failures.join('\n')).toContain('fonts.gstatic.com');
  });

  it('catches the font files a blocked stylesheet would have pulled', () => {
    const css = "@font-face { font-family: X; src: url('https://fonts.gstatic.com/s/a.woff2'); }";
    expect(violations(scanCss(css, 'remote.css'))).toEqual([
      expect.stringContaining('needs https://fonts.gstatic.com in font-src'),
    ]);
  });

  it('passes the fonts this site actually serves, which are same-origin', () => {
    const css = "@font-face { font-family: X; src: url('./fonts/fredoka-latin.woff2'); }";
    expect(scanCss(css, 'fonts.css')).toEqual([]);
  });

  it('says nothing about a plain link out, which loads nothing', () => {
    const markup = '<a href="https://github.com/DuelBox/DuelBox-Web">source</a>';
    expect(scanMarkup(markup, 'SiteFooter.tsx')).toEqual([]);
  });

  it('ignores an origin that only appears in prose', () => {
    const markup = '// see https://fonts.googleapis.com for why this used to be here';
    expect(scanMarkup(markup, 'layout.tsx')).toEqual([]);
    expect(scanCss('/* was https://fonts.googleapis.com */', 'fonts.css')).toEqual([]);
  });

  it('reads a scheme, a wildcard host and a port the way CSP does', () => {
    const origin = new URL('https://cdn.example.com');
    expect(expressionPermits('*', origin)).toBe(true);
    expect(expressionPermits('https:', origin)).toBe(true);
    expect(expressionPermits('http:', origin)).toBe(false);
    expect(expressionPermits('*.example.com', origin)).toBe(true);
    expect(expressionPermits('*.other.com', origin)).toBe(false);
    expect(expressionPermits('cdn.example.com', origin)).toBe(true);
    expect(expressionPermits("'self'", origin)).toBe(false);
    expect(expressionPermits("'unsafe-inline'", origin)).toBe(false);
    // The default port is the same origin written two ways, and 8443 is not.
    expect(expressionPermits('https://cdn.example.com:443', origin)).toBe(true);
    expect(expressionPermits('https://cdn.example.com:8443', origin)).toBe(false);
  });

  it('falls a directive the policy does not name back to default-src', () => {
    // `frame-src` is absent, so an iframe is governed by `child-src` and then `'none'`.
    expect(sourcesFor('frame-src')).toEqual(["'none'"]);
  });
});
