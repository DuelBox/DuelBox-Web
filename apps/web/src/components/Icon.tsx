import { iconId, type IconName } from '@/lib/icons';

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
      className={className}
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
