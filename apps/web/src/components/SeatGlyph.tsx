import type { SeatId } from '@duelbox/engine';

/**
 * The mark that identifies a seat.
 *
 * Colour is never the only signal (CLAUDE.md rule 7), so each seat also owns a shape:
 * Pip is a disc, Bo is a rounded square. In greyscale, on a projector, or to a player who
 * cannot separate red from blue, the shape still says whose it is.
 */
export function SeatGlyph({ seat, size = 18 }: { seat: SeatId; size?: number }) {
  const fill = seat === 'p1' ? 'var(--db-p1)' : 'var(--db-p2)';
  const stroke = seat === 'p1' ? 'var(--db-p1-deep)' : 'var(--db-p2-deep)';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {seat === 'p1' ? (
        <circle cx="12" cy="12" r="9" fill={fill} stroke={stroke} strokeWidth="2.5" />
      ) : (
        <rect x="3" y="3" width="18" height="18" rx="5" fill={fill} stroke={stroke} strokeWidth="2.5" />
      )}
    </svg>
  );
}
