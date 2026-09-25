/**
 * CSS colour strings, as the GPU needs them (#16).
 *
 * Every colour that crosses {@link Renderer} is a CSS string — `SEAT_PALETTE.p1.base` is
 * `'#ff5a4e'`, a shadow is `'rgba(0, 0, 0, 0.25)'`, a game writes `'black'` — because that
 * is what a 2D context takes and what a designer reads. A shader takes four floats. The
 * conversion happens here, once per distinct string, and is then a `Map` lookup: a game
 * draws the same dozen colours thousands of times a match, and parsing one on every call
 * would allocate the substrings rule 5 forbids on the render path.
 *
 * What is parsed is what the catalogue actually draws with, measured before this was
 * written: 842 hex literals in three, four, six and eight digits, 252 `rgba(r, g, b, a)`
 * calls with and without spaces, and a handful of named colours. `rgb()` with a `/` alpha
 * and percentages are accepted because they cost nothing to accept. Anything else —
 * `hsl()`, a gradient, a name outside the small table — is not guessed at: the host may
 * hand in a `normalise` fallback that asks a 2D context what the browser makes of the
 * string, and without one the parse throws, which is what a test wants and what a game
 * never triggers because its palette is constant.
 */

/** Red, green, blue and alpha, each in [0, 1]. Four floats, never an object per parse. */
export type Rgba = Float32Array;

const NAMED: Readonly<Record<string, readonly [number, number, number, number]>> = {
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
  transparent: [0, 0, 0, 0],
  red: [1, 0, 0, 1],
  green: [0, 128 / 255, 0, 1],
  blue: [0, 0, 1, 1],
  yellow: [1, 1, 0, 1],
  orange: [1, 165 / 255, 0, 1],
  grey: [128 / 255, 128 / 255, 128 / 255, 1],
  gray: [128 / 255, 128 / 255, 128 / 255, 1],
};

/** A colour string this module does not understand and no fallback could either. */
export class UnknownColourError extends RangeError {
  constructor(css: string) {
    super(`cannot parse colour "${css}" for the WebGL renderer`);
    this.name = 'UnknownColourError';
  }
}

function hexDigit(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 102) return code - 87;
  if (code >= 65 && code <= 70) return code - 55;
  return -1;
}

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` into `out`; false if it is not one of those. */
function parseHex(css: string, out: Rgba): boolean {
  const n = css.length - 1;
  if (n !== 3 && n !== 4 && n !== 6 && n !== 8) return false;
  const short = n <= 4;
  const digits = short ? 1 : 2;
  const channels = n / digits;
  for (let c = 0; c < 4; c += 1) {
    if (c === 3 && channels === 3) {
      out[3] = 1;
      break;
    }
    let value = 0;
    for (let d = 0; d < digits; d += 1) {
      const digit = hexDigit(css.charCodeAt(1 + c * digits + d));
      if (digit < 0) return false;
      value = value * 16 + digit;
    }
    out[c] = (short ? value * 17 : value) / 255;
  }
  return true;
}

/**
 * `rgb(...)` / `rgba(...)` with commas or spaces, a `/` or fourth-argument alpha, and
 * percentages on any channel. Returns false for anything else so the caller can fall back.
 */
function parseRgb(css: string, out: Rgba): boolean {
  const open = css.indexOf('(');
  const close = css.lastIndexOf(')');
  if (open < 0 || close < open) return false;
  const head = css.slice(0, open).trim().toLowerCase();
  if (head !== 'rgb' && head !== 'rgba') return false;
  const parts = css
    .slice(open + 1, close)
    .replace('/', ' ')
    .split(/[\s,]+/)
    .filter((part) => part.length > 0);
  if (parts.length !== 3 && parts.length !== 4) return false;
  for (let i = 0; i < 4; i += 1) {
    const part = parts[i];
    if (part === undefined) {
      out[3] = 1;
      break;
    }
    const percent = part.endsWith('%');
    const value = Number(percent ? part.slice(0, -1) : part);
    if (!Number.isFinite(value)) return false;
    const unit = i === 3 ? (percent ? value / 100 : value) : percent ? value / 100 : value / 255;
    out[i] = unit < 0 ? 0 : unit > 1 ? 1 : unit;
  }
  return true;
}

/**
 * Parse `css` into `out`. Pure and allocation-free for hex and named colours; `rgb()`
 * allocates the split it parses, which is why callers go through {@link ColourCache}.
 */
export function parseColour(css: string, out: Rgba): boolean {
  const trimmed = css.trim();
  if (trimmed.startsWith('#')) return parseHex(trimmed, out);
  const named = NAMED[trimmed.toLowerCase()];
  if (named !== undefined) {
    out[0] = named[0];
    out[1] = named[1];
    out[2] = named[2];
    out[3] = named[3];
    return true;
  }
  return parseRgb(trimmed, out);
}

/**
 * What the host may hand in for a colour this module cannot read: the browser's own
 * answer, usually by setting `fillStyle` on a scratch 2D context and reading it back as the
 * normalised `#rrggbb` or `rgba()` string the browser prints. Null means "the browser could
 * not either", which is then an error rather than a guess.
 */
export type ColourNormaliser = (css: string) => string | null;

/**
 * Colour strings to four floats, remembered forever.
 *
 * Forever is the right lifetime: a game's palette is a fixed set of constants, and a string
 * that is seen once is seen every frame. A cache that evicted would re-parse on the render
 * path; one that does not is a `Map.get` per draw call and no allocation once warm.
 */
export class ColourCache {
  readonly #cache = new Map<string, Rgba>();
  readonly #normalise: ColourNormaliser | null;

  constructor(normalise: ColourNormaliser | null = null) {
    this.#normalise = normalise;
  }

  /** Distinct strings parsed so far. Flat once a game has drawn every colour it owns. */
  get size(): number {
    return this.#cache.size;
  }

  /**
   * The four floats for `css`. The same `Float32Array` is returned for the same string, so
   * callers must copy rather than keep it.
   *
   * @throws UnknownColourError for a string neither the parser nor the normaliser can read.
   */
  get(css: string): Rgba {
    const cached = this.#cache.get(css);
    if (cached !== undefined) return cached;
    const out = new Float32Array(4);
    if (!parseColour(css, out)) {
      const normalised = this.#normalise?.(css) ?? null;
      if (normalised === null || !parseColour(normalised, out)) throw new UnknownColourError(css);
    }
    this.#cache.set(css, out);
    return out;
  }
}
