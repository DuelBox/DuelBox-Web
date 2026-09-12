import { iconClassName, iconId, type IconName } from '@/lib/icons';

/**
 * One interface glyph, referenced from the sprite (#74).
 *
 * A `<use>` into the `<symbol>` `IconSprite` put in the document, so the geometry is not
 * repeated per icon. `currentColor` throughout the sprite means this takes the surrounding
 * text colour unless a `className` sets one.
 *
 * Labelling is the caller's decision because it depends on what the icon is doing. An icon
 * beside its own text label is decorative — pass no `label`, and it is `aria-hidden` so a
 * screen reader does not read the picture and the word both. An icon that is the only thing
 * in a control — a bare mute button — carries the meaning, so pass a `label` and it becomes
 * an `img` with that accessible name. This is CLAUDE.md rule 7 in miniature: the glyph is
 * never the only signal unless a name rides with it.
 *
 * Under a right-to-left shell the glyphs that point along the line of reading turn round
 * and the rest do not (#222): `MIRRORED_ICONS` in `lib/icons.ts` says which, this adds
 * `MIRROR_CLASS` for those, and `globals.css` scales that class by `--db-inline-sign` — -1
 * in the shell, 1 again inside the play surface's `ltr` island, so an arrow drawn inside a
 * match stays put. The decision is per name and not per use — an arrow that means "back"
 * means it wherever it is drawn.
 */
export function Icon({
  name,
  label,
  size = 24,
  className,
}: {
  name: IconName;
  label?: string;
  size?: number;
  className?: string;
}) {
  const decorative = label === undefined;
  return (
    <svg
      className={iconClassName(name, className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : label}
      focusable="false"
    >
      <use href={`#${iconId(name)}`} />
    </svg>
  );
}
