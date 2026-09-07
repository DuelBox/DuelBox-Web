import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRITICAL_THRESHOLD,
  healthBarRotated,
  healthBarView,
  healthLevelLabel,
  LOW_THRESHOLD,
} from './health-bar';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(join(here, name), 'utf8');

describe('healthBarView (#1753)', () => {
  it('clamps the reported value into [0, 1] as a width', () => {
    expect(healthBarView(0.5).percent).toBe(50);
    expect(healthBarView(1.4).value).toBe(1);
    expect(healthBarView(-0.2).value).toBe(0);
  });

  it('reads a non-finite report as empty, never full', () => {
    // A garbage value must not read as a full bar — better to show empty and be obviously
    // wrong than to hide a broken game behind a healthy-looking bar.
    expect(healthBarView(Number.NaN).value).toBe(0);
    expect(healthBarView(Number.POSITIVE_INFINITY).value).toBe(0);
  });

  it('grades the level by shape, not just colour', () => {
    expect(healthBarView(0.9).level).toBe('ok');
    expect(healthBarView(LOW_THRESHOLD).level).toBe('low');
    expect(healthBarView(0.3).level).toBe('low');
    expect(healthBarView(CRITICAL_THRESHOLD).level).toBe('critical');
    expect(healthBarView(0.05).level).toBe('critical');
  });

  it('gives every level a word, so the state survives greyscale', () => {
    expect(healthLevelLabel('ok')).toBe('Healthy');
    expect(healthLevelLabel('low')).toBe('Low');
    expect(healthLevelLabel('critical')).toBe('Critical');
  });
});

describe('per-seat orientation', () => {
  it('turns only the far seat, and never in single-seat', () => {
    expect(healthBarRotated('p1', 'shared-screen', 'p1')).toBe(false);
    expect(healthBarRotated('p2', 'shared-screen', 'p1')).toBe(true);
    expect(healthBarRotated('p2', 'single-seat', 'p1')).toBe(false);
  });
});

describe('the component and its stylesheet', () => {
  it('differs by shape and label as well as colour (rule 7)', () => {
    const css = read('HealthBarHud.module.css');
    // A non-colour cue for the low/critical states: a hatch on the track.
    expect(css).toMatch(/data-level='low'/);
    expect(css).toMatch(/data-level='critical'/);
    expect(css).toContain('repeating-linear-gradient');
    // And a label word in the component.
    expect(read('HealthBarHud.tsx')).toContain('healthLevelLabel');
  });

  it('animates smoothly and switches the motion off under reduced-motion', () => {
    const css = read('HealthBarHud.module.css');
    // The fill transitions with a token the reduced-motion block can collapse.
    expect(css).toMatch(/transition:\s*width var\(--db-duration\)/);
    expect(css).toContain('prefers-reduced-motion');
  });

  it('orients each seat with the rotate-180 pattern', () => {
    expect(read('HealthBarHud.module.css')).toMatch(/\.rotated\s*\{[^}]*rotate\(180deg\)/s);
    expect(read('HealthBarHud.tsx')).toContain('healthBarRotated');
  });
});
