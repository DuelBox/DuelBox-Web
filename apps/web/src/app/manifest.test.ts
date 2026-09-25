import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import manifestRoute from './manifest';

/**
 * The web manifest and the icon set (#73).
 *
 * The manifest reads `NEXT_PUBLIC_BASE_PATH` when it runs, so each case sets the env and
 * calls it again — a project page serves from `/<repo>/`, and an icon `src` or a `start_url`
 * that forgot the prefix would 404 on the one host the prefix exists for. The icon files are
 * checked to share the one mark, so a reskin cannot quietly change three of four.
 */

const here = dirname(fileURLToPath(import.meta.url));
const app = here;
const publicDir = join(here, '..', '..', 'public');

function loadManifest(basePath: string | undefined): Record<string, unknown> {
  if (basePath === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
  else process.env.NEXT_PUBLIC_BASE_PATH = basePath;
  // The route reads the env inside itself, so calling it again with a new env is enough —
  // no module-cache bust needed. The manifest's keys are all strings, so it is already a
  // `Record<string, unknown>` and needs no assertion.
  return manifestRoute();
}

describe('the web manifest', () => {
  const original = process.env.NEXT_PUBLIC_BASE_PATH;
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = original;
  });

  it('names the app and paints in the brand colour', () => {
    const manifest = loadManifest('');
    expect(manifest['name']).toBe('DuelBox');
    expect(manifest['display']).toBe('standalone');
    expect(manifest['theme_color']).toBe('#4b3beb');
  });

  it('carries an any and a maskable icon, both SVG', () => {
    const manifest = loadManifest('');
    const icons = manifest['icons'] as { src: string; purpose: string; type: string }[];
    const purposes = icons.map((icon) => icon.purpose);
    expect(purposes).toContain('any');
    expect(purposes).toContain('maskable');
    for (const icon of icons) expect(icon.type).toBe('image/svg+xml');
  });

  it('joins the base path onto every URL when the site is not root-served', () => {
    const manifest = loadManifest('/DuelBox-Web');
    expect(manifest['start_url']).toBe('/DuelBox-Web/');
    expect(manifest['scope']).toBe('/DuelBox-Web/');
    const icons = manifest['icons'] as { src: string }[];
    for (const icon of icons) expect(icon.src.startsWith('/DuelBox-Web/')).toBe(true);
  });

  it('leaves the URLs root-relative when there is no base path', () => {
    const manifest = loadManifest('');
    expect(manifest['start_url']).toBe('/');
    const icons = manifest['icons'] as { src: string }[];
    for (const icon of icons) expect(icon.src.startsWith('/manifest-icon')).toBe(true);
  });
});

describe('the icon files', () => {
  const files = [
    join(app, 'icon.svg'),
    join(app, 'apple-icon.svg'),
    join(publicDir, 'manifest-icon.svg'),
    join(publicDir, 'manifest-icon-maskable.svg'),
  ];

  it('all exist and share the one mark', () => {
    for (const path of files) {
      const svg = readFileSync(path, 'utf8');
      // The brand indigo and the seam path are the mark; every file carries them.
      expect(svg, path).toContain('#4b3beb');
      expect(svg, path).toContain('M46 12 18 52');
    }
  });

  it('gives the maskable icon a safe-zone inset the others do not have', () => {
    const maskable = readFileSync(join(publicDir, 'manifest-icon-maskable.svg'), 'utf8');
    expect(maskable).toContain('scale(0.6)');
  });

  it('keeps the favicon corners transparent and the apple icon full-bleed', () => {
    const favicon = readFileSync(join(app, 'icon.svg'), 'utf8');
    const apple = readFileSync(join(app, 'apple-icon.svg'), 'utf8');
    // The favicon insets its rounded rect (transparent corners); the apple icon fills to the
    // edge because iOS masks it itself.
    expect(favicon).toContain('x="2" y="2" width="60" height="60"');
    expect(apple).toContain('width="64" height="64"');
  });
});
