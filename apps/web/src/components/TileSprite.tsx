import type { CatalogueEntry } from '@/data/catalogue.generated';
import {
  CHIPS,
  CHIP_ART,
  FIELDS,
  FIELD_ART,
  MARKS,
  MARK_ART,
  MARK_INSET,
  RADIUS,
  tileFor,
} from '@/lib/tiles';
import type { ChipName, FieldName, MarkName, Shape } from '@/lib/tiles';

/**
 * The tile artwork for one page, defined once and referenced by every card on it.
 *
 * The catalogue page shows a hundred and eight tiles. Inlining each one's geometry a
 * hundred and eight times is the obvious way to do it and the wrong one: it is the same
 * dozen paths repeated, and the page is HTML that a browser has to parse before it can show
 * anything. So the geometry goes in once, as `<symbol>`s, and each tile is three `<use>`
 * elements — about two hundred bytes of markup instead of six hundred.
 *
 * Only the marks, fields and chips the page actually shows are emitted, so a game's own
 * page carries the seven it needs rather than all thirty-four.
 *
 * Same-document `<use>`, deliberately, rather than a sprite file: a `<use>` pointing into a
 * separate `.svg` is a second network request that blocks the art, and external references
 * have never worked identically across engines. Nothing here needs a file.
 */

const CLIP_ID = 'db-tile-clip';

export const tileClip = `url(#${CLIP_ID})`;
export const markId = (mark: MarkName): string => `db-tile-m-${mark}`;
export const fieldId = (field: FieldName): string => `db-tile-f-${field}`;
export const chipId = (chip: ChipName): string => `db-tile-c-${chip}`;

/**
 * One drawing primitive as SVG. Every mark goes through this, so the whole set shares a
 * stroke weight, a cap and a join without any of them being restated per glyph — and a new
 * mark cannot draw itself differently from the geometry `tiles.test.ts` compared.
 *
 * `currentColor` throughout: the `<use>` that references the symbol sets `color`, and the
 * referenced content inherits it, so one symbol serves every tile that wants that shape.
 */
function draw(shape: Shape, key: number) {
  if (shape.kind === 'rect') {
    return (
      <rect
        key={key}
        x={shape.x}
        y={shape.y}
        width={shape.w}
        height={shape.h}
        rx={shape.r}
        fill="currentColor"
      />
    );
  }
  if (shape.kind === 'circle') {
    return <circle key={key} cx={shape.cx} cy={shape.cy} r={shape.r} fill="currentColor" />;
  }
  if (shape.kind === 'ring') {
    return (
      <circle
        key={key}
        cx={shape.cx}
        cy={shape.cy}
        r={shape.r}
        fill="none"
        stroke="currentColor"
        strokeWidth={shape.weight}
      />
    );
  }
  if (shape.kind === 'fill') {
    return <path key={key} d={shape.d} fill="currentColor" />;
  }
  return (
    <path
      key={key}
      d={shape.d}
      fill="none"
      stroke="currentColor"
      strokeWidth={shape.weight}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/** Scaling about the centre of the 64 grid, so the inset does not move the mark off it. */
const INSET = `translate(${String(32 * (1 - MARK_INSET))} ${String(32 * (1 - MARK_INSET))}) scale(${String(MARK_INSET)})`;

function Symbols({
  id,
  shapes,
  inset = false,
}: {
  id: string;
  shapes: readonly Shape[];
  inset?: boolean;
}) {
  const art = shapes.map((shape, index) => draw(shape, index));
  return (
    <symbol id={id} viewBox="0 0 64 64">
      {inset ? <g transform={INSET}>{art}</g> : art}
    </symbol>
  );
}

export function TileSprite({ games }: { games: readonly CatalogueEntry[] }) {
  const specs = games.map(tileFor);
  // Filtered out of the canonical arrays rather than collected from the specs, so the
  // emitted order is the vocabulary's order and two builds of the same page agree.
  const marks = MARKS.filter((mark) => specs.some((spec) => spec.mark === mark));
  const fields = FIELDS.filter(
    (field) => field !== 'plain' && specs.some((spec) => spec.field === field),
  );
  const chips = CHIPS.filter((chip) => specs.some((spec) => spec.chip === chip));

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
    >
      <defs>
        {fields.length > 0 ? (
          // The fields are drawn past the tile's edges on purpose; this is what stops them
          // spilling out of its rounded corners.
          <clipPath id={CLIP_ID}>
            <rect width="64" height="64" rx={RADIUS} />
          </clipPath>
        ) : null}
        {fields.map((field) => (
          <Symbols key={field} id={fieldId(field)} shapes={FIELD_ART[field]} />
        ))}
        {marks.map((mark) => (
          <Symbols key={mark} id={markId(mark)} shapes={MARK_ART[mark]} inset />
        ))}
        {chips.map((chip) => (
          <Symbols key={chip} id={chipId(chip)} shapes={CHIP_ART[chip]} />
        ))}
      </defs>
    </svg>
  );
}
