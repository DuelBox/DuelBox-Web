/**
 * The share card, everywhere a canvas is not needed to test it (#164).
 *
 * `drawShareCard` is driven against a recording context, so what is asserted is what would
 * be drawn and where — not pixels, which are the engine's, but the positions, the text and
 * the faces, which are ours. The layout is arithmetic over one box and is tested as that.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SEAT_CHARACTERS } from './seats';
import { SITE_URL } from './site';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  drawShareCard,
  fontsToLoad,
  shareCardFilename,
  shareCardLayout,
  shareCardUrl,
  shareableName,
  verdictLine,
  type ShareCardData,
} from './share-card';

const DATA: ShareCardData = {
  game: 'Crash It',
  slug: 'crash-it',
  names: { p1: 'Ada', p2: 'Grace (bot)' },
  score: { p1: 3, p2: 1 },
  outcome: 'p1',
};

/** A context that writes down every call, in order, rather than drawing. */
function recordingContext() {
  const calls: { name: string; args: unknown[] }[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_, name: string) {
      if (name in state) return state[name];
      return (...args: unknown[]) => {
        calls.push({ name, args });
      };
    },
    set(_, name: string, value: unknown) {
      state[name] = value;
      calls.push({ name: `set ${name}`, args: [value] });
      return true;
    },
  });
  return { ctx, calls };
}

describe('the layout', () => {
  it('is the Open Graph size, and every position is inside it', () => {
    const layout = shareCardLayout();
    expect([layout.width, layout.height]).toEqual([CARD_WIDTH, CARD_HEIGHT]);
    expect([CARD_WIDTH, CARD_HEIGHT]).toEqual([1200, 630]);
    const points = [
      layout.title,
      layout.dash,
      layout.verdict,
      layout.link,
      layout.seats.p1.glyph,
      layout.seats.p1.name,
      layout.seats.p1.score,
      layout.seats.p2.glyph,
      layout.seats.p2.name,
      layout.seats.p2.score,
    ];
    for (const point of points) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(layout.width);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(layout.height);
    }
  });

  it('puts the two seats either side of the centre line, the same distance out', () => {
    const layout = shareCardLayout();
    const centre = layout.width / 2;
    expect(centre - layout.seats.p1.name.x).toBe(layout.seats.p2.name.x - centre);
    expect(layout.seats.p1.name.x).toBeLessThan(centre);
    expect(layout.dash.x).toBe(centre);
  });

  it('scales with the box rather than being written in pixels', () => {
    const small = shareCardLayout(600, 315);
    const full = shareCardLayout();
    expect(small.title.x).toBe(full.title.x / 2);
    expect(small.seats.p2.score.y).toBe(full.seats.p2.score.y / 2);
  });

  it('names only the faces the site self-hosts, so two browsers draw the same text', () => {
    // `fonts.css` is what `globals.css` loads; a face named here and not there would be
    // drawn in whatever the platform falls back to, which differs per platform.
    const css = readFileSync(
      fileURLToPath(new URL('../styles/fonts.css', import.meta.url)),
      'utf8',
    );
    const families = new Set([...css.matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]));
    for (const spec of fontsToLoad(shareCardLayout())) {
      const family = /\d+px\s+"?([^"]+)"?$/.exec(spec)?.[1];
      expect(family, spec).toBeDefined();
      expect(families.has(family ?? ''), `${spec} names a face fonts.css does not ship`).toBe(true);
    }
  });
});

describe('what it says', () => {
  it('names the winner in words, and a draw as a draw', () => {
    expect(verdictLine(DATA)).toBe('Ada wins at Crash It');
    expect(verdictLine({ ...DATA, outcome: 'draw' })).toBe('A draw at Crash It');
  });

  it("links back to the game's own page, with nothing personal in the address", () => {
    const url = shareCardUrl('crash-it');
    expect(url).toBe(`${SITE_URL}/games/crash-it/`);
    expect(url).not.toContain('?');
  });

  it('names the file by the game and the score, never by a player', () => {
    expect(shareCardFilename(DATA)).toBe('duelbox-crash-it-3-1.png');
  });

  it('substitutes the character for a name that may not leave the device (#161)', () => {
    expect(shareableName('p1', { p1: 'Scunthorpe', p2: 'Grace' })).toBe('Scunthorpe');
    expect(shareableName('p1', { p1: 'sh1t', p2: 'Grace' })).toBe(SEAT_CHARACTERS.p1);
    expect(verdictLine({ ...DATA, names: { p1: 'sh1t', p2: 'Grace' } })).toBe(
      `${SEAT_CHARACTERS.p1} wins at Crash It`,
    );
  });
});

describe('what it draws', () => {
  it('draws the game, both names, both scores, the verdict and the address', () => {
    const { ctx, calls } = recordingContext();
    drawShareCard(ctx, shareCardLayout(), DATA);
    const texts = calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
    expect(texts).toContain('Crash It');
    expect(texts).toContain('Ada');
    expect(texts).toContain('Grace (bot)');
    expect(texts).toContain('3');
    expect(texts).toContain('1');
    expect(texts).toContain('Ada wins at Crash It');
    expect(texts).toContain(`${SITE_URL}/games/crash-it/`);
  });

  it('gives each seat its own shape as well as its colour (rule 7)', () => {
    const { ctx, calls } = recordingContext();
    drawShareCard(ctx, shareCardLayout(), DATA);
    // p1 is a disc: one `arc` of a full turn. p2 is a rounded square: `arcTo` corners.
    const arcs = calls.filter((c) => c.name === 'arc');
    expect(arcs.length).toBe(1);
    expect(arcs[0]?.args[4]).toBeCloseTo(Math.PI * 2);
    expect(calls.filter((c) => c.name === 'arcTo').length).toBeGreaterThan(4);
  });

  it('sets a face before every piece of text, so nothing is drawn in the default font', () => {
    const { ctx, calls } = recordingContext();
    drawShareCard(ctx, shareCardLayout(), DATA);
    let font: unknown = null;
    for (const call of calls) {
      if (call.name === 'set font') font = call.args[0];
      if (call.name === 'fillText') expect(font, `text "${String(call.args[0])}"`).not.toBeNull();
    }
  });

  it('draws the blocked name as the character, so the filter reaches the picture', () => {
    const { ctx, calls } = recordingContext();
    drawShareCard(ctx, shareCardLayout(), { ...DATA, names: { p1: 'f_u_c_k', p2: 'Grace' } });
    const texts = calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
    expect(texts).not.toContain('f_u_c_k');
    expect(texts).toContain(SEAT_CHARACTERS.p1);
  });
});
