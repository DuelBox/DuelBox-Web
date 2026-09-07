/**
 * The web app manifest, checked against the files it names and the rules it has to keep.
 *
 * A manifest is the one part of this that nothing else in the build reads: a wrong icon path
 * or a shortcut to a route that does not exist produces no error anywhere — it produces a
 * blank square on somebody's home screen, months later, on a device nobody here owns.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import manifest from './manifest';
import { BASE_PATH } from './base-path';

const value = manifest();
const publicDir = fileURLToPath(new URL('../../public/', import.meta.url));

/** `/icons/icon.svg` under a base path of `''`; `/repo/icons/icon.svg` under one. */
const asFile = (url: string) => publicDir + url.slice(BASE_PATH.length + 1);

describe('the web app manifest', () => {
  it('scopes itself to the base path the rest of the build uses', () => {
    expect(value.start_url).toBe(`${BASE_PATH}/`);
    expect(value.scope).toBe(`${BASE_PATH}/`);
  });

  it('names a file that exists, for every icon and every shortcut icon', () => {
    const sources = [
      ...(value.icons ?? []).map((icon) => icon.src),
      ...(value.shortcuts ?? []).flatMap((shortcut) => (shortcut.icons ?? []).map((i) => i.src)),
    ];
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(existsSync(asFile(source)), `${source} is named by the manifest`).toBe(true);
    }
  });

  it('ships a maskable icon that is a different drawing from the plain one', () => {
    const maskable = (value.icons ?? []).filter((icon) => icon.purpose === 'maskable');
    const plain = (value.icons ?? []).filter((icon) => icon.purpose === 'any');
    expect(maskable.length).toBeGreaterThan(0);
    expect(plain.length).toBeGreaterThan(0);
    // Declaring one file as both is the usual shortcut and it produces either a clipped
    // mark or a small one adrift in a coloured field, depending on the platform's mask.
    for (const one of maskable) {
      expect(plain.map((icon) => icon.src)).not.toContain(one.src);
    }
  });

  it('offers a 192 and a 512 PNG, which is what an install prompt looks for', () => {
    const sizes = (value.icons ?? [])
      .filter((icon) => icon.type === 'image/png')
      .map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('does not lock the orientation', () => {
    // Two seats read a shared screen differently in portrait than in landscape, and the
    // definition of done requires both. A manifest that pinned one would overrule the
    // choice the two players just made by turning the device.
    expect(value.orientation).toBeUndefined();
  });

  it('only shortcuts to routes the service worker precaches', () => {
    // A shortcut that opens the offline page is worse than no shortcut. These three are in
    // SHELL_ROUTES in scripts/emit-service-worker.mjs; a per-game shortcut would not be.
    const precached = ['/', '/games/', '/how-to-play/', '/privacy/', '/terms/', '/offline/'];
    for (const shortcut of value.shortcuts ?? []) {
      expect(precached).toContain(shortcut.url.slice(BASE_PATH.length));
    }
  });
});
