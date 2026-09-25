import type { Meta, StoryObj } from '@storybook/react';
import { Icon } from '../../apps/web/src/components/Icon';
import { ICONS } from '../../apps/web/src/lib/icons';

/**
 * The interface glyph set (#74), a story per state.
 *
 * `Icon` is the clearest thing to exercise in Storybook: it is self-contained, its states are
 * a small matrix — which glyph, decorative or labelled, at what size — and it renders through
 * the sprite the preview decorator mounts. Flip the toolbar theme and the whole gallery
 * re-colours, because the glyphs draw in `currentColor` and the surface is a token.
 */
const meta: Meta<typeof Icon> = {
  title: 'Foundations/Icon',
  component: Icon,
  args: { name: 'play', size: 32 },
  argTypes: {
    name: { control: 'select', options: [...ICONS] },
    size: { control: { type: 'range', min: 16, max: 96, step: 4 } },
    label: { control: 'text' },
  },
};
export default meta;

type Story = StoryObj<typeof Icon>;

/** Decorative: no label, `aria-hidden`, meant to sit beside its own text. */
export const Decorative: Story = {
  args: { name: 'play' },
};

/** Meaningful: the only thing in its control, so it carries a label and becomes an `img`. */
export const Labelled: Story = {
  args: { name: 'sound-off', label: 'Sound is off' },
};

/** Every glyph at once, which is also the eye test for the set reading as one family. */
export const Gallery: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
        gap: 'var(--db-space-4)',
      }}
    >
      {ICONS.map((name) => (
        <figure
          key={name}
          style={{ display: 'grid', justifyItems: 'center', gap: 'var(--db-space-2)', margin: 0 }}
        >
          <Icon name={name} size={40} />
          <figcaption style={{ font: 'var(--db-text-sm)', color: 'var(--db-muted)' }}>
            {name}
          </figcaption>
        </figure>
      ))}
    </div>
  ),
};
