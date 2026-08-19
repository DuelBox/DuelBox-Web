#!/usr/bin/env node
/**
 * Scaffold a new game package.
 *
 *   pnpm create-game <id>
 *
 * With 107 games to build, the cost of starting one has to be near zero. This produces a
 * package that compiles, is registered, and renders a placeholder frame — so the first
 * commit on a game is its rules, not its boilerplate.
 *
 * Metadata comes from data/catalog.yaml so the scaffold already knows the game's name,
 * category, archetype and observed rules.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ARCHETYPE_DEFAULTS = {
  'turn-board': { logical: [900, 900], zoneSplit: 'shared-board', orientation: 'any', round: 90 },
  'turn-aim': {
    logical: [700, 1000],
    zoneSplit: 'shared-board',
    orientation: 'portrait',
    round: 90,
  },
  'rt-split': { logical: [600, 1000], zoneSplit: 'horizontal', orientation: 'portrait', round: 60 },
  'rt-arena': { logical: [800, 800], zoneSplit: 'shared-board', orientation: 'any', round: 40 },
  'rt-race': { logical: [600, 1000], zoneSplit: 'horizontal', orientation: 'portrait', round: 75 },
};

function fail(message) {
  process.stderr.write(`create-game: ${message}\n`);
  process.exit(1);
}

const id = process.argv[2];
if (!id) fail('usage: pnpm create-game <id>');
if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(id)) fail(`"${id}" must be lowercase kebab-case`);

const target = join(ROOT, 'packages', 'games', id);
if (existsSync(target)) fail(`packages/games/${id} already exists`);

// Read the game's row out of the generated catalogue rather than re-implementing a YAML
// parser here. `pnpm catalogue` regenerates it from data/catalog.yaml.
const cataloguePath = join(ROOT, 'data', 'catalog.generated.json');
if (!existsSync(cataloguePath))
  fail('run `pnpm catalogue` first to generate data/catalog.generated.json');
const catalogue = JSON.parse(readFileSync(cataloguePath, 'utf8'));
const entry = catalogue.games.find((game) => game.id === id);

const name = entry?.name ?? id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const category = entry?.category ?? 'Party';
const archetype = entry?.archetype ?? 'rt-split';
const modes = entry?.modes?.length ? entry.modes : ['friend', 'bot'];
const defaults = ARCHETYPE_DEFAULTS[archetype] ?? ARCHETYPE_DEFAULTS['rt-split'];
const [width, height] = defaults.logical;

if (!entry) {
  process.stderr.write(
    `create-game: "${id}" is not in the catalogue — scaffolding with defaults.\n` +
      'Add it to data/catalog.yaml and run `pnpm catalogue` so the two agree.\n',
  );
}

const write = (relative, contents) => {
  const path = join(target, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
};

write(
  'package.json',
  JSON.stringify(
    {
      name: `@duelbox/game-${id}`,
      version: '0.0.0',
      private: true,
      type: 'module',
      main: './dist/index.js',
      types: './dist/index.d.ts',
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
      scripts: { build: 'tsc --build', clean: 'tsc --build --clean' },
      dependencies: { '@duelbox/engine': 'workspace:*', '@duelbox/game-sdk': 'workspace:*' },
    },
    null,
    2,
  ) + '\n',
);

write(
  'tsconfig.json',
  JSON.stringify(
    {
      extends: '../../../tsconfig.base.json',
      compilerOptions: { rootDir: './src', outDir: './dist' },
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      references: [{ path: '../../engine' }, { path: '../../game-sdk' }],
    },
    null,
    2,
  ) + '\n',
);

write(
  'src/manifest.ts',
  `import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: '${id}',
  name: '${name}',
  category: '${category}',
  archetype: '${archetype}',
  modes: ${JSON.stringify(modes)},
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: ${String(width)}, height: ${String(height)} },
  orientation: '${defaults.orientation}',
  zoneSplit: '${defaults.zoneSplit}',
  roundSeconds: ${String(entry?.roundSeconds ?? defaults.round)},
  tags: [],
});
`,
);

write(
  'src/rules.ts',
  `import type { SeatId } from '@duelbox/engine';

/**
 * Pure rules for ${name}. No rendering, no timing, no DOM — the bot and the balance
 * harness reuse this module, so anything that touches a canvas belongs in game.ts.
 */

export interface State {
  readonly p1: number;
  readonly p2: number;
}

export function createState(): State {
  return { p1: 0, p2: 0 };
}

export function winnerOf(_state: State): SeatId | 'draw' | null {
  // TODO: implement the win condition from SPEC.md using the SDK's resolve() helper.
  return null;
}
`,
);

write(
  'src/rules.test.ts',
  `import { describe, expect, it } from 'vitest';
import { createState, winnerOf } from './rules.js';

describe('${name} rules', () => {
  it('starts level with no winner', () => {
    const state = createState();
    expect(state.p1).toBe(0);
    expect(state.p2).toBe(0);
    expect(winnerOf(state)).toBeNull();
  });

  // TODO: cover every terminal state, illegal moves, and the edge cases in SPEC.md.
});
`,
);

write(
  'src/game.ts',
  `import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { createState, type State } from './rules.js';

export class ${name.replace(/[^A-Za-z0-9]/g, '')}Game implements Game {
  #state: State = createState();

  init(_context: GameContext): void {
    this.#state = createState();
  }

  update(_dt: number, _input: InputState): void {
    // TODO: simulate. Runs on the fixed timestep; must not allocate.
  }

  render(renderer: Renderer): void {
    renderer.clear('#f7f8fc');
    renderer.text(
      manifest.name,
      manifest.logical.width / 2,
      manifest.logical.height / 2,
      48,
      '#14161f',
      'centre',
    );
  }

  onPause(): void {}
  onResume(): void {}

  getScore(): MatchScore {
    return { p1: this.#state.p1, p2: this.#state.p2, winner: null };
  }

  destroy(): void {}
}
`,
);

write(
  'src/index.ts',
  `import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { ${name.replace(/[^A-Za-z0-9]/g, '')}Game } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new ${name.replace(/[^A-Za-z0-9]/g, '')}Game(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
`,
);

process.stdout.write(
  `created packages/games/${id} (${name}, ${archetype})\n\n` +
    'Next:\n' +
    `  1. add { "path": "./packages/games/${id}" } to tsconfig.json references\n` +
    `  2. add "@duelbox/game-${id}": "workspace:*" to apps/web/package.json\n` +
    `  3. add the loader to apps/web/src/data/registry.ts\n` +
    '  4. pnpm install && pnpm typecheck && pnpm test\n',
);
