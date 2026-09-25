import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generatedModule } from '../../../../scripts/emit-icon-sprite.mjs';
import { ICON_NAMES } from '../lib/icon-art.mjs';
import { ICON_SPRITE } from './icon-sprite.generated';

/**
 * The committed icon sprite is what the emitter would write (#74).
 *
 * `icon-sprite.generated.ts` is generated and committed, which is only safe if it cannot
 * drift from its source. This fails the moment the file on disk stops matching a fresh run
 * of `scripts/emit-icon-sprite.mjs` — a hand-edit, or a change to `icon-art.mjs` without
 * re-running the emitter — which is the same guard `tokens.test.ts` puts on its mirrored
 * pair. The remedy the failure names is `pnpm emit:icons`.
 */

const generatedPath = fileURLToPath(new URL('./icon-sprite.generated.ts', import.meta.url));

describe('the generated icon sprite', () => {
  it('matches exactly what the emitter would write now', () => {
    const onDisk = readFileSync(generatedPath, 'utf8');
    expect(onDisk, 'run `pnpm emit:icons` to regenerate').toBe(generatedModule());
  });

  it('carries a symbol for every glyph', () => {
    for (const name of ICON_NAMES) {
      expect(ICON_SPRITE, name).toContain(`id="db-icon-${name}"`);
    }
  });

  it('is a defs-ready string of symbols and nothing else', () => {
    // No stray wrapper: `IconSprite` supplies the <svg><defs>, so the string is symbols only.
    expect(ICON_SPRITE.startsWith('<symbol')).toBe(true);
    expect(ICON_SPRITE).not.toContain('<svg');
  });
});
