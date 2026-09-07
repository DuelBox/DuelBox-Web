import type { Decorator, Preview } from '@storybook/react';
import type { ReactElement } from 'react';
import { IconSprite } from '../apps/web/src/components/IconSprite';

// The real thing the components are designed against: the token stylesheet and the shell's
// base styles. Storybook renders every story through these, so a component looks in a story
// exactly as it does in the app — the whole point of a token-driven design system.
import '../apps/web/src/styles/tokens.css';
import '../apps/web/src/app/globals.css';

/**
 * A token-driven theme decorator (#75).
 *
 * The shell's look is entirely in the tokens: light is the bare `:root`, dark is
 * `data-theme="dark"`, and the colour-blind seats are `data-seat-palette="colourblind"` — the
 * same attributes the app's inline script and `theme.ts` set at runtime. So the decorator does
 * not reimplement the theme; it sets those two attributes from two Storybook toolbar globals
 * and lets the exact same cascade paint the story. Flip the toolbar and every story is
 * re-themed, which is how a reviewer checks a component in dark mode or with the alternative
 * palette without leaving the page.
 *
 * `IconSprite` is rendered once here so any story using `<Icon>` resolves its `<use>` — the
 * same reason the app mounts it high in the tree.
 */
const withTokens: Decorator = (Story, context): ReactElement => {
  const theme = context.globals['theme'] as string | undefined;
  const seatPalette = context.globals['seatPalette'] as string | undefined;
  return (
    <div
      data-theme={theme === 'system' ? undefined : theme}
      data-seat-palette={seatPalette === 'colourblind' ? 'colourblind' : undefined}
      style={{
        background: 'var(--db-surface)',
        color: 'var(--db-ink)',
        padding: 'var(--db-space-5)',
        minHeight: '100vh',
      }}
    >
      <IconSprite />
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [withTokens],
  globalTypes: {
    theme: {
      description: 'Colour scheme',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon: 'contrast',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
    seatPalette: {
      description: 'Seat palette',
      defaultValue: 'default',
      toolbar: {
        title: 'Seats',
        icon: 'paintbrush',
        items: [
          { value: 'default', title: 'Standard' },
          { value: 'colourblind', title: 'Colour-blind' },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    // The stories are rendered on the token surface, so let axe judge against it rather than
    // Storybook's default white.
    layout: 'fullscreen',
    controls: { expanded: true },
  },
};

export default preview;
