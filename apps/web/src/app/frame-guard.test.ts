import { describe, expect, it } from 'vitest';
import {
  type AncestorOrigins,
  ancestorOrigin,
  checkFrame,
  evaluateFrameGuard,
  frameAncestorsDirective,
  type FrameWindow,
  isAllowedEmbedder,
  NON_EMBED_FRAME_ANCESTORS,
  parseAllowedOrigins,
  resolveAllowedOrigins,
  SELF_TOKEN,
} from './frame-guard';

const SELF = 'https://duelbox.example';
const ALLY = 'https://portal.example';

/** A window as the guard reads it. `ancestors` are the origins framing this one, parent first. */
function frame(options: {
  framed: boolean;
  ancestors?: readonly string[];
  referrer?: string;
  origin?: string;
}): FrameWindow {
  const self = {};
  const top = options.framed ? {} : self;
  const location: { origin: string; ancestorOrigins?: AncestorOrigins } = {
    origin: options.origin ?? SELF,
  };
  if (options.ancestors !== undefined) {
    const list = options.ancestors;
    const ao: Record<number, string> & { length: number; item(i: number): string | null } = {
      length: list.length,
      item: (i: number) => list[i] ?? null,
    };
    list.forEach((value, i) => {
      ao[i] = value;
    });
    location.ancestorOrigins = ao;
  }
  return {
    self,
    top,
    location,
    ...(options.referrer === undefined ? {} : { document: { referrer: options.referrer } }),
  };
}

describe('parseAllowedOrigins', () => {
  it('keeps self as a token and reduces URLs to bare origins', () => {
    expect(parseAllowedOrigins('self, https://a.example/embed, https://b.example')).toEqual([
      SELF_TOKEN,
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('drops blanks, duplicates and anything that is not an absolute URL', () => {
    expect(
      parseAllowedOrigins('self self, not-a-url, https://a.example, https://a.example/x'),
    ).toEqual([SELF_TOKEN, 'https://a.example']);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins('')).toEqual([]);
  });
});

describe('resolveAllowedOrigins / isAllowedEmbedder', () => {
  it('reads self against the page origin', () => {
    expect(resolveAllowedOrigins([SELF_TOKEN, ALLY], SELF)).toEqual([SELF, ALLY]);
    expect(isAllowedEmbedder(SELF, [SELF_TOKEN], SELF)).toBe(true);
    expect(isAllowedEmbedder(ALLY, [SELF_TOKEN], SELF)).toBe(false);
    expect(isAllowedEmbedder(ALLY, [SELF_TOKEN, ALLY], SELF)).toBe(true);
  });
});

describe('frameAncestorsDirective', () => {
  it('is none for the empty (non-embed) list and a keyword-plus-origins list otherwise', () => {
    expect(frameAncestorsDirective([])).toBe(NON_EMBED_FRAME_ANCESTORS);
    expect(frameAncestorsDirective([])).toBe("'none'");
    expect(frameAncestorsDirective([SELF_TOKEN, ALLY])).toBe("'self' https://portal.example");
  });
});

describe('ancestorOrigin', () => {
  it('prefers ancestorOrigins, index zero, the immediate parent', () => {
    expect(ancestorOrigin(frame({ framed: true, ancestors: [ALLY, SELF] }))).toBe(ALLY);
  });

  it('falls back to the referrer origin where ancestorOrigins is absent (Firefox)', () => {
    expect(ancestorOrigin(frame({ framed: true, referrer: `${ALLY}/some/page` }))).toBe(ALLY);
  });

  it('is null when neither is available', () => {
    expect(ancestorOrigin(frame({ framed: true }))).toBeNull();
    expect(ancestorOrigin(frame({ framed: true, referrer: '' }))).toBeNull();
  });
});

describe('evaluateFrameGuard', () => {
  const base = { allowlist: [SELF_TOKEN, ALLY], selfOrigin: SELF };

  it('allows a page that is not framed', () => {
    expect(evaluateFrameGuard({ framed: false, ancestorOrigin: null, ...base }).allowed).toBe(true);
  });

  it('allows a framed page from an allowlisted origin', () => {
    const result = evaluateFrameGuard({ framed: true, ancestorOrigin: ALLY, ...base });
    expect(result.allowed).toBe(true);
  });

  it('refuses a framed page from a non-allowlisted origin', () => {
    const result = evaluateFrameGuard({
      framed: true,
      ancestorOrigin: 'https://evil.example',
      ...base,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not on the embed allowlist');
  });

  it('refuses when the ancestor origin cannot be determined', () => {
    expect(evaluateFrameGuard({ framed: true, ancestorOrigin: null, ...base }).allowed).toBe(false);
  });

  it('refuses any framing at all under the empty (non-embed) allowlist', () => {
    expect(
      evaluateFrameGuard({ framed: true, ancestorOrigin: ALLY, allowlist: [], selfOrigin: SELF })
        .allowed,
    ).toBe(false);
    // But a non-embed page at the top level is fine.
    expect(
      evaluateFrameGuard({ framed: false, ancestorOrigin: null, allowlist: [], selfOrigin: SELF })
        .allowed,
    ).toBe(true);
  });
});

describe('checkFrame end to end', () => {
  it('permits the embed same-origin and refuses a stranger', () => {
    const allowlist = [SELF_TOKEN, ALLY];
    expect(checkFrame(frame({ framed: false }), allowlist).allowed).toBe(true);
    expect(checkFrame(frame({ framed: true, ancestors: [ALLY] }), allowlist).allowed).toBe(true);
    expect(checkFrame(frame({ framed: true, ancestors: [SELF] }), allowlist).allowed).toBe(true);
    expect(
      checkFrame(frame({ framed: true, ancestors: ['https://evil.example'] }), allowlist).allowed,
    ).toBe(false);
  });
});
