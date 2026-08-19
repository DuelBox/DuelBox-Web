import { colour } from '@/styles/tokens';

/**
 * One game's catalogue tile.
 *
 * 107 games need 107 pictures, and commissioning 107 illustrations is neither affordable
 * nor consistent. Instead each tile is a tint plus one flat mark drawn on a shared grid,
 * chosen from the game's archetype — so a new game costs two data fields, the whole set
 * reads as one family, and the bytes stay inside the catalogue budget.
 */

const TINTS: Record<string, string> = {
  sunTint: colour.sunTint,
  grassTint: colour.grassTint,
  p1Tint: colour.p1Tint,
  p2Tint: colour.p2Tint,
  brandTint: colour.brandTint,
  surface: colour.surface,
};

const MARKS: Record<string, string> = {
  sunTint: colour.sun,
  grassTint: colour.grass,
  p1Tint: colour.p1,
  p2Tint: colour.p2,
  brandTint: colour.brand,
  surface: colour.muted,
};

function Mark({ mark, fill }: { mark: string; fill: string }) {
  switch (mark) {
    case 'grid':
      return (
        <g stroke={fill} strokeWidth="6" strokeLinecap="round">
          <path d="M24 8v48M40 8v48M8 24h48M8 40h48" />
        </g>
      );
    case 'target':
      return (
        <g fill="none" stroke={fill} strokeWidth="6">
          <circle cx="32" cy="32" r="22" />
          <circle cx="32" cy="32" r="9" fill={fill} stroke="none" />
        </g>
      );
    case 'split':
      return (
        <g fill={fill}>
          <rect x="8" y="10" width="48" height="18" rx="9" />
          <rect x="8" y="36" width="48" height="18" rx="9" opacity="0.45" />
        </g>
      );
    case 'ring':
      return (
        <g fill="none" stroke={fill} strokeWidth="7">
          <circle cx="32" cy="32" r="21" />
        </g>
      );
    case 'chevron':
      return (
        <g fill="none" stroke={fill} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 44L32 20l16 24" />
        </g>
      );
    default:
      return <circle cx="32" cy="32" r="20" fill={fill} />;
  }
}

export function GameTile({ tint, mark, name }: { tint: string; mark: string; name: string }) {
  const background = TINTS[tint] ?? colour.surface;
  const fill = MARKS[tint] ?? colour.muted;
  return (
    <svg
      viewBox="0 0 64 64"
      width="100%"
      role="img"
      aria-label={`${name} game tile`}
      style={{ display: 'block', borderRadius: 'var(--db-radius-lg)', background }}
    >
      <Mark mark={mark} fill={fill} />
    </svg>
  );
}
