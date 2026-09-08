import type { SeatId } from '@duelbox/engine';
import { containsBlockedWord } from '@duelbox/game-sdk';
import { SEAT_CHARACTERS, type SeatNames } from './seats';
import { absoluteUrl } from './site';
import { colour, seatColour } from '../styles/tokens';

/**
 * The result of a match as a picture two people can send to a third (#164).
 *
 * ## Why it is a picture
 *
 * A shared result is the cheapest distribution a browser game has, and a messenger shows a
 * picture where it truncates a sentence. The card carries the game, both names, the score
 * and the address of the game's page — and nothing else, which is the whole of the privacy
 * criterion: no time, no device, no record, no query string. The names are the one piece of
 * personal data on it, and they are the names the pair typed for themselves.
 *
 * ## Reached by `import()`, never imported
 *
 * This module is fetched the first time somebody presses Share, the way `SoundToggle`
 * reaches `lib/audio`. It is the play route so it is on-demand either way, but a visitor
 * who never presses the button never downloads the canvas code — and most will not.
 * `size-budget.json` carries what it costs.
 *
 * ## "Renders identically across browsers"
 *
 * Three things decide that and all three are pinned. The canvas is a fixed 1200×630 at a
 * device pixel ratio of exactly one — the Open Graph size, and the size every messenger
 * already lays out for — so the same picture is produced on a phone and a laptop. Every
 * position is a pure function of that box (`shareCardLayout`), tested without a canvas.
 * And the faces are the site's own self-hosted ones, awaited through `document.fonts.load`
 * before a glyph is drawn, because a font that has not arrived is the one way two browsers
 * disagree about text: the fallback face differs per platform, and the metrics with it.
 *
 * What is *not* claimed: bit-identical rasterisation. Anti-aliasing is the engine's, and two
 * engines will disagree about the grey at a curve's edge. Same picture, same bytes of
 * meaning; not the same file hash.
 *
 * ## Rule 7, on a picture
 *
 * A screenshot is read in greyscale more often than a screen is — printed, forwarded through
 * a compressor, or seen by one of the people rule 7 exists for. So each seat carries its own
 * shape beside its name, the disc and the rounded square `SeatGlyph` draws on the page, and
 * the winner is named in words rather than pointed at with colour.
 *
 * ## The name filter, and where it sits
 *
 * `containsBlockedWord` (#161) is applied here and only here. A player may call themselves
 * what they like on their own screen; this is the one artefact that leaves the device, and a
 * name that would get the picture taken down is a picture nobody can share. A blocked name
 * becomes the seat's own character name and the card says nothing about it.
 */

/** The Open Graph size. Not configurable: the whole point is one picture everywhere. */
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

export interface ShareCardData {
  /** The game's display name, from the manifest. */
  readonly game: string;
  /** The route slug, for the address on the card. */
  readonly slug: string;
  readonly names: SeatNames;
  /** The score to show — round wins for a best-of, the round's tally for a single round. */
  readonly score: Readonly<Record<SeatId, number>>;
  readonly outcome: SeatId | 'draw';
}

/** A face and size, in the form `document.fonts.load` and `ctx.font` both take. */
export interface FontSpec {
  readonly css: string;
}

/** Everything drawn, as positions in the card's own pixels. Pure; no canvas needed. */
export interface ShareCardLayout {
  readonly width: number;
  readonly height: number;
  readonly title: { x: number; y: number; font: FontSpec };
  readonly seats: Readonly<
    Record<
      SeatId,
      {
        /** The glyph's centre and half-size. */
        glyph: { x: number; y: number; half: number };
        name: { x: number; y: number; font: FontSpec };
        score: { x: number; y: number; font: FontSpec };
      }
    >
  >;
  readonly dash: { x: number; y: number; font: FontSpec };
  readonly verdict: { x: number; y: number; font: FontSpec };
  readonly link: { x: number; y: number; font: FontSpec };
  /** The band behind the score, so the numbers sit on a ground of their own. */
  readonly band: { x: number; y: number; width: number; height: number; radius: number };
}

const DISPLAY = 'Fredoka';
const BODY = 'Plus Jakarta Sans';

/** Font specs at the card's own scale. Weights are the ones `fonts.css` actually ships. */
const FONT = {
  title: { css: `600 48px ${DISPLAY}` },
  name: { css: `600 44px ${DISPLAY}` },
  score: { css: `600 120px ${DISPLAY}` },
  dash: { css: `600 80px ${DISPLAY}` },
  verdict: { css: `400 34px "${BODY}"` },
  link: { css: `400 26px "${BODY}"` },
} as const;

/**
 * Where everything goes, from the size alone.
 *
 * Two columns on a centre line, the score band across the middle, the verdict and the
 * address below. Every number here is a fraction of the box, so the layout can be tested
 * as arithmetic — and so nothing about it is a fact about one browser's text metrics.
 */
export function shareCardLayout(width = CARD_WIDTH, height = CARD_HEIGHT): ShareCardLayout {
  const centreX = width / 2;
  const columnOffset = width * 0.23;
  const glyphY = height * 0.3;
  const nameY = height * 0.41;
  const scoreY = height * 0.62;
  return {
    width,
    height,
    title: { x: centreX, y: height * 0.13, font: FONT.title },
    seats: {
      p1: {
        glyph: { x: centreX - columnOffset, y: glyphY, half: 30 },
        name: { x: centreX - columnOffset, y: nameY, font: FONT.name },
        score: { x: centreX - columnOffset, y: scoreY, font: FONT.score },
      },
      p2: {
        glyph: { x: centreX + columnOffset, y: glyphY, half: 30 },
        name: { x: centreX + columnOffset, y: nameY, font: FONT.name },
        score: { x: centreX + columnOffset, y: scoreY, font: FONT.score },
      },
    },
    dash: { x: centreX, y: scoreY, font: FONT.dash },
    verdict: { x: centreX, y: height * 0.8, font: FONT.verdict },
    link: { x: centreX, y: height * 0.92, font: FONT.link },
    band: {
      x: width * 0.12,
      y: height * 0.5,
      width: width * 0.76,
      height: height * 0.24,
      radius: 28,
    },
  };
}

/** The name the card shows for a seat: what the pair typed, unless it may not leave the device. */
export function shareableName(seat: SeatId, names: SeatNames): string {
  const name = names[seat];
  return containsBlockedWord(name) ? SEAT_CHARACTERS[seat] : name;
}

/** The sentence under the score. Words, not a colour, say who won (rule 7). */
export function verdictLine(data: ShareCardData): string {
  if (data.outcome === 'draw') return `A draw at ${data.game}`;
  return `${shareableName(data.outcome, data.names)} wins at ${data.game}`;
}

/** The address printed on the card, which is also the one a share carries as its URL. */
export function shareCardUrl(slug: string): string {
  return absoluteUrl(`/games/${slug}/`);
}

/** The file name a download gets: the game, then the score, nothing personal. */
export function shareCardFilename(data: ShareCardData): string {
  return `duelbox-${data.slug}-${String(data.score.p1)}-${String(data.score.p2)}.png`;
}

/** The faces the card needs, each in the exact weight and size it will be drawn at. */
export function fontsToLoad(layout: ShareCardLayout): readonly string[] {
  const specs = [
    layout.title.font,
    layout.seats.p1.name.font,
    layout.seats.p1.score.font,
    layout.dash.font,
    layout.verdict.font,
    layout.link.font,
  ];
  return [...new Set(specs.map((spec) => spec.css))];
}

/** A rounded rectangle path, drawn by hand so the picture does not depend on `roundRect`. */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** The seat's mark: a disc for p1, a rounded square for p2 — `SeatGlyph`, in canvas. */
function drawGlyph(
  ctx: CanvasRenderingContext2D,
  seat: SeatId,
  x: number,
  y: number,
  half: number,
): void {
  ctx.fillStyle = seatColour[seat].base;
  ctx.strokeStyle = seatColour[seat].deep;
  ctx.lineWidth = half / 4;
  if (seat === 'p1') {
    ctx.beginPath();
    ctx.arc(x, y, half - ctx.lineWidth / 2, 0, Math.PI * 2);
  } else {
    const inset = ctx.lineWidth / 2;
    roundedRect(
      ctx,
      x - half + inset,
      y - half + inset,
      2 * (half - inset),
      2 * (half - inset),
      half / 2.4,
    );
  }
  ctx.fill();
  ctx.stroke();
}

/**
 * Draws the whole card into `ctx`, which must already be the layout's size.
 *
 * Separated from {@link renderShareCard} so it can be driven against a fake context in a
 * unit test and the calls counted, and so the canvas creation — the one part that touches
 * the DOM — is the smallest possible function.
 */
export function drawShareCard(
  ctx: CanvasRenderingContext2D,
  layout: ShareCardLayout,
  data: ShareCardData,
): void {
  ctx.fillStyle = colour.paper;
  ctx.fillRect(0, 0, layout.width, layout.height);

  ctx.fillStyle = colour.surface;
  roundedRect(
    ctx,
    layout.band.x,
    layout.band.y,
    layout.band.width,
    layout.band.height,
    layout.band.radius,
  );
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = colour.ink;
  ctx.font = layout.title.font.css;
  ctx.fillText(data.game, layout.title.x, layout.title.y);

  for (const seat of ['p1', 'p2'] as const) {
    const column = layout.seats[seat];
    drawGlyph(ctx, seat, column.glyph.x, column.glyph.y, column.glyph.half);
    ctx.fillStyle = colour.ink;
    ctx.font = column.name.font.css;
    ctx.fillText(shareableName(seat, data.names), column.name.x, column.name.y, layout.width * 0.4);
    ctx.font = column.score.font.css;
    ctx.fillText(String(data.score[seat]), column.score.x, column.score.y);
  }

  ctx.fillStyle = colour.muted;
  ctx.font = layout.dash.font.css;
  ctx.fillText('–', layout.dash.x, layout.dash.y);

  ctx.fillStyle = colour.body;
  ctx.font = layout.verdict.font.css;
  ctx.fillText(verdictLine(data), layout.verdict.x, layout.verdict.y, layout.width * 0.9);

  ctx.fillStyle = colour.brand;
  ctx.font = layout.link.font.css;
  ctx.fillText(shareCardUrl(data.slug), layout.link.x, layout.link.y, layout.width * 0.9);
}

/**
 * The card as a PNG, drawn after the faces it needs have arrived.
 *
 * `document.fonts.load` resolves with the faces it found; a face that is not declared
 * resolves to an empty list rather than rejecting, so a missing font is a wrong picture and
 * not a thrown error. That is why `fonts.css` is held to these families by `share-card.test.ts`.
 */
export async function renderShareCard(data: ShareCardData): Promise<Blob> {
  const layout = shareCardLayout();
  await Promise.all(fontsToLoad(layout).map((css) => document.fonts.load(css)));
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2d context for the share card');
  drawShareCard(ctx, layout, data);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('the share card could not be encoded'));
      else resolve(blob);
    }, 'image/png');
  });
}

/** How long the object URL outlives the click — the `SettingsPanel` export's own reason. */
const REVOKE_DELAY_MS = 1000;

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/**
 * Hands the card to the share sheet where there is one, and to the downloads folder where
 * there is not.
 *
 * `canShare` with files is the question, not `share` alone: a browser can have the sheet and
 * still refuse files (older Safari did), and the fallback is the right answer there too. A
 * share the person dismissed rejects with `AbortError`, which is not a failure and is not
 * turned into a download they did not ask for.
 */
export async function shareOrDownload(blob: Blob, data: ShareCardData): Promise<ShareOutcome> {
  const filename = shareCardFilename(data);
  const file = new File([blob], filename, { type: 'image/png' });
  // Read as unknowns rather than through the DOM type: `lib.dom` declares both as always
  // present, and the whole point here is that on many browsers they are not.
  const nav = navigator as unknown as {
    canShare?: (payload: ShareData) => boolean;
    share?: (payload: ShareData) => Promise<void>;
  };
  if (
    typeof nav.share === 'function' &&
    typeof nav.canShare === 'function' &&
    nav.canShare({ files: [file] })
  ) {
    try {
      await nav.share({ files: [file], title: verdictLine(data), url: shareCardUrl(data.slug) });
      return 'shared';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
      // Anything else — a sheet that opened and failed — falls through to the download.
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, REVOKE_DELAY_MS);
  return 'downloaded';
}
