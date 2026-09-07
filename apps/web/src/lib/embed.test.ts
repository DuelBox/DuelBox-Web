import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PLAYABLE } from '../data/registry';
import {
  EMBED_BRAND,
  embedBacklinkLabel,
  embedBacklinkPath,
  embedIframeSrcPath,
  embedSnippet,
  embedStaticParams,
} from './embed';

const APP = new URL('../app/', import.meta.url);
function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, APP)), 'utf8');
}
const page = read('embed/[slug]/page.tsx');
const frame = read('embed/[slug]/EmbedFrame.tsx');

describe('the embed helpers', () => {
  it('builds an embed for exactly the playable games', () => {
    expect(embedStaticParams()).toEqual(PLAYABLE.map((slug) => ({ slug })));
    expect(embedStaticParams().length).toBeGreaterThan(0);
  });

  it('points the backlink at the game’s own page', () => {
    expect(embedBacklinkPath('chess')).toBe('/games/chess/');
    expect(embedIframeSrcPath('chess')).toBe('/embed/chess/');
    expect(embedBacklinkLabel('Chess')).toBe(`Play Chess on ${EMBED_BRAND}`);
  });

  it('documents a snippet with an absolute src and an accessible title', () => {
    const snippet = embedSnippet('chess', 'Chess', 'https://duelbox.example/DuelBox-Web');
    expect(snippet).toContain('src="https://duelbox.example/DuelBox-Web/embed/chess/"');
    expect(snippet).toContain('title="Chess on DuelBox"');
    expect(snippet).toContain('<iframe');
  });
});

/**
 * The route's own security and branding properties, asserted against its source. The route is
 * a server + client component tree that pulls in the whole game host, which is more than a
 * node test should import; scanning the source is how the repository already checks a route it
 * cannot cheaply render (see `csp-origins.test.ts` and `privacy-claims.test.ts`).
 */
describe('the embed route', () => {
  it('renders DuelBox branding and a backlink to the game page', () => {
    expect(page).toContain('Wordmark');
    expect(page).toContain('embedBacklinkPath');
    expect(page).toContain('embedBacklinkLabel');
    // The backlink and brand both open out to the game page, severing the opener.
    expect(page).toContain('rel="noopener noreferrer"');
    expect(page).toContain('target="_blank"');
  });

  it('is marked noindex so it does not compete with the game page in search', () => {
    expect(page).toContain('index: false');
  });

  it('enforces the frame allowlist and owns the postMessage channel in the client half', () => {
    expect(frame).toContain('checkFrame');
    expect(frame).toContain('EMBED_ALLOWED_ORIGINS');
    expect(frame).toContain('receiveEmbedMessage');
    // A blocked frame gets a link out rather than the board.
    expect(frame).toContain('setBlocked');
    expect(frame).toContain('backlinkHref');
  });
});
