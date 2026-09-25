import type { Meta, StoryObj } from '@storybook/react';

/**
 * The design tokens themselves (#75), so the theme decorator has something that is nothing but
 * tokens to prove itself against.
 *
 * Every swatch is a `var(--db-…)`, so flipping the toolbar between light and dark, or between
 * the standard and colour-blind seat palettes, repaints this whole page from the cascade —
 * which is exactly the check a reviewer wants before trusting that a real component will
 * re-theme too.
 */
const meta: Meta = {
  title: 'Foundations/Tokens',
};
export default meta;

type Story = StoryObj;

function Swatch({ token, label }: { token: string; label: string }) {
  return (
    <figure style={{ margin: 0, display: 'grid', gap: 'var(--db-space-2)' }}>
      <div
        style={{
          height: '3rem',
          borderRadius: 'var(--db-radius)',
          background: `var(${token})`,
          border: '1px solid var(--db-border)',
        }}
      />
      <figcaption style={{ font: 'var(--db-text-sm)', color: 'var(--db-muted)' }}>
        {label}
        <br />
        <code>{token}</code>
      </figcaption>
    </figure>
  );
}

const GROUPS: { heading: string; swatches: { token: string; label: string }[] }[] = [
  {
    heading: 'Brand and status',
    swatches: [
      { token: '--db-brand', label: 'Brand' },
      { token: '--db-danger', label: 'Danger' },
      { token: '--db-success', label: 'Success' },
    ],
  },
  {
    heading: 'Seats (re-colour with the palette toolbar)',
    swatches: [
      { token: '--db-p1', label: 'Seat one' },
      { token: '--db-p2', label: 'Seat two' },
    ],
  },
  {
    heading: 'Surfaces and ink',
    swatches: [
      { token: '--db-surface', label: 'Surface' },
      { token: '--db-paper', label: 'Paper' },
      { token: '--db-ink', label: 'Ink' },
      { token: '--db-muted', label: 'Muted' },
    ],
  },
];

export const Palette: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--db-space-6)' }}>
      {GROUPS.map((group) => (
        <section key={group.heading} style={{ display: 'grid', gap: 'var(--db-space-3)' }}>
          <h2 style={{ font: 'var(--db-text-lg)', margin: 0 }}>{group.heading}</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 'var(--db-space-4)',
            }}
          >
            {group.swatches.map((swatch) => (
              <Swatch key={swatch.token} token={swatch.token} label={swatch.label} />
            ))}
          </div>
        </section>
      ))}
    </div>
  ),
};
