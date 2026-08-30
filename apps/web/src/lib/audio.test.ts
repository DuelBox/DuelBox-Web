import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The shell must actually reach the audio system.
 *
 * The engine's `AudioSystem` is thorough — the iOS silent-buffer path, the visibility
 * re-arm, an allocation-free queue, thirty-four tests — and none of that is worth anything
 * if nothing calls it. It has now been unreachable twice. It was written in 558e362 and
 * called by nothing; a36f7ad wired it up and said so in its message; and then cc0431b,
 * a commit about adding eight games, deleted all forty-nine lines of that wiring again.
 * Between those two points the site shipped silent, every audio test passed, and no gate
 * step noticed — because every gate step was asking whether the *engine* worked.
 *
 * So this asks the question the gate was not asking: is the thing plugged in. It is a
 * source-level assertion rather than a rendered-component one, and that is a deliberate
 * trade — mounting `PlaySurface` needs a DOM, a router and a registry, which is a large
 * amount of scaffolding to prove one call exists, and the failure it guards against is a
 * deletion rather than a subtle behaviour change. A deletion is exactly what a source
 * assertion catches.
 *
 * If this test is in your way because you are deliberately removing audio from the shell,
 * delete it in the same commit and say so in the message. That is the difference between
 * a decision and an accident, and only one of those needs catching.
 */

const here = dirname(fileURLToPath(import.meta.url));
const componentsDir = join(here, '..', 'components');

function componentSource(name: string): string {
  return readFileSync(join(componentsDir, name), 'utf8');
}

describe('the shell is wired to the audio system', () => {
  it('arms the unlock from the page that mounts before Start is pressed', () => {
    // PlaySurface specifically, not GameHost. GameHost mounts only after Start, by which
    // point the gesture that should have unlocked audio is already spent — the first match
    // would be silent, which is the failure #167 describes.
    const source = componentSource('PlaySurface.tsx');
    expect(source, 'PlaySurface no longer imports the audio helper').toContain('@/lib/audio');
    expect(source, 'PlaySurface no longer calls armAudio()').toMatch(/armAudio\(\)/);
  });

  it('flushes queued sounds once a frame from the host', () => {
    const source = componentSource('GameHost.tsx');
    expect(source, 'GameHost no longer imports the audio helper').toContain('@/lib/audio');
    // Outside the fixed step on purpose: a game queues during update() and the queue is
    // drained in render(), so playing a sound stays allocation-free (rule 5).
    expect(source, 'GameHost no longer flushes the audio queue').toMatch(/audio\(\)\.flush\(\)/);
  });

  it('keeps one system for the tab, built lazily', () => {
    // Two contexts do not get two permissions — the autoplay policy is granted per
    // document — so a second system would be permanently suspended while the first played.
    // And it must not be constructed at module scope: this site is a static export, and
    // touching AudioContext while the build machine renders the page throws.
    const source = readFileSync(join(here, 'audio.ts'), 'utf8');
    expect(source).toMatch(/let system: AudioSystem \| null = null/);
    expect(source, 'the system is being built at module scope').not.toMatch(
      /^const system = new AudioSystem\(\)/m,
    );
  });

  it('asks nobody for permission', () => {
    // Rule from the engine module: unlocking is a side effect of a tap the player was
    // always going to make. A prompt would be a regression in product terms, not a bug.
    for (const name of readdirSync(componentsDir).filter((f) => f.endsWith('.tsx'))) {
      const source = componentSource(name);
      expect(source, `${name} appears to prompt for sound`).not.toMatch(
        /enable\s+sound|allow\s+audio|turn\s+on\s+sound/i,
      );
    }
  });
});
