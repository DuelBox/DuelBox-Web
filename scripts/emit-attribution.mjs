#!/usr/bin/env node
/**
 * The third-party attribution list, generated rather than maintained by hand (#215).
 *
 * Open-source licences require attribution, and a hand-kept list is a list that is wrong the
 * first time a dependency is added or bumped. So this composes it from the two places the
 * truth already lives:
 *
 *   - **Runtime dependencies** — the non-`@duelbox/*` `dependencies` declared across the
 *     workspace package.json files (the packages that actually ship to a browser). Each one's
 *     version, licence and homepage are read from its installed `package.json`, resolved from
 *     the workspace package that declares it, so the numbers are the resolved ones the lockfile
 *     pinned rather than a range typed here.
 *   - **Fonts** — the OFL faces already recorded in `apps/web/assets.license.json`, deduped to
 *     one entry per family.
 *
 * It emits `apps/web/src/app/attribution/attribution-data.generated.ts`, which the `/attribution`
 * route renders. There is no timestamp in the output, deliberately: a timestamp would make the
 * file change on every run and defeat the staleness check below.
 *
 * ## Two modes
 *
 *   node scripts/emit-attribution.mjs            # write the generated module
 *   node scripts/emit-attribution.mjs --check    # exit 1 if the committed module is stale
 *
 * The `--check` mode is what makes "regenerates automatically when dependencies change" true:
 * `apps/web/src/app/attribution/attribution.generated.test.ts` runs the same builder and asserts
 * the committed data matches, so a dependency bump that is not re-emitted fails CI. That is the
 * same pattern `research-provenance.test.ts` uses — a committed artefact guarded against going
 * stale, rather than trusted to have been regenerated.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GENERATED_PATH = join(
  ROOT,
  'apps',
  'web',
  'src',
  'app',
  'attribution',
  'attribution-data.generated.ts',
);

/** The workspace package.json files whose runtime `dependencies` ship to a browser. */
const WORKSPACE_MANIFESTS = [
  'apps/web/package.json',
  'packages/engine/package.json',
  'packages/game-sdk/package.json',
  'packages/ui/package.json',
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function homepageOf(pkg) {
  if (typeof pkg.homepage === 'string' && pkg.homepage) return pkg.homepage;
  const repo = pkg.repository;
  const url = typeof repo === 'string' ? repo : (repo && repo.url) || '';
  return url
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^git:\/\//, 'https://');
}

function licenceOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license === 'object' && pkg.license.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses) && pkg.licenses[0]?.type) return pkg.licenses[0].type;
  return 'UNKNOWN';
}

/** Collect third-party runtime deps across the workspace, remembering who declares each. */
function collectRuntimeDependencies() {
  const declaredBy = new Map(); // dep name -> workspace manifest path that declares it
  for (const rel of WORKSPACE_MANIFESTS) {
    let manifest;
    try {
      manifest = readJson(join(ROOT, rel));
    } catch {
      continue; // a workspace package may not exist in every checkout; skip cleanly
    }
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      if (dep.startsWith('@duelbox/')) continue; // first-party, covered by the repo licence
      if (!declaredBy.has(dep)) declaredBy.set(dep, rel);
    }
  }

  const entries = [];
  for (const [dep, viaRel] of declaredBy) {
    const req = createRequire(pathToFileURL(join(ROOT, viaRel)));
    const pkg = req(`${dep}/package.json`);
    entries.push({
      name: pkg.name ?? dep,
      version: pkg.version ?? '0.0.0',
      licence: licenceOf(pkg),
      homepage: homepageOf(pkg),
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

/** The OFL font families, one entry per family, from the app's own asset licence record. */
function collectFonts() {
  const licenceFile = readJson(join(ROOT, 'apps', 'web', 'assets.license.json'));
  const byFamily = new Map();
  for (const asset of licenceFile.assets ?? []) {
    if (typeof asset.family !== 'string' || !asset.family) continue; // only the font entries
    if (byFamily.has(asset.family)) continue;
    byFamily.set(asset.family, {
      family: asset.family,
      licence: asset.licence ?? 'UNKNOWN',
      licenceUrl: asset.licenceUrl ?? '',
      author: asset.author ?? '',
      source: asset.source ?? '',
    });
  }
  return [...byFamily.values()].sort((a, b) => a.family.localeCompare(b.family));
}

export function buildAttribution() {
  return {
    runtime: collectRuntimeDependencies(),
    fonts: collectFonts(),
  };
}

function render(data) {
  return `/**
 * GENERATED by scripts/emit-attribution.mjs — do not edit by hand.
 *
 * The third-party attribution list rendered at /attribution (#215). Regenerate with
 * \`pnpm emit:attribution\`; \`pnpm check:attribution\` (and attribution.generated.test.ts) fail
 * if this file is stale relative to the installed dependencies and the font licence record.
 */

export interface RuntimeDependency {
  readonly name: string;
  readonly version: string;
  readonly licence: string;
  readonly homepage: string;
}

export interface FontAttribution {
  readonly family: string;
  readonly licence: string;
  readonly licenceUrl: string;
  readonly author: string;
  readonly source: string;
}

export const RUNTIME_DEPENDENCIES: readonly RuntimeDependency[] = ${JSON.stringify(
    data.runtime,
    null,
    2,
  )};

export const FONT_ATTRIBUTIONS: readonly FontAttribution[] = ${JSON.stringify(data.fonts, null, 2)};
`;
}

/**
 * Only run the CLI when invoked directly, never when imported. `attribution.generated.test.ts`
 * imports `buildAttribution` from this file to check the committed data is fresh, and it must
 * not trigger a write or an `exit` by doing so.
 */
function main() {
  const isCheck = process.argv.includes('--check');
  const rendered = render(buildAttribution());

  if (isCheck) {
    let current = '';
    try {
      current = readFileSync(GENERATED_PATH, 'utf8');
    } catch {
      current = '';
    }
    if (current !== rendered) {
      console.error(
        'check:attribution — attribution-data.generated.ts is stale.\n' +
          'A dependency changed (or the font licence record did) and the attribution page was not\n' +
          'regenerated. Run `pnpm emit:attribution` and commit the result.',
      );
      process.exit(1);
    }
    console.log('check:attribution: attribution data is up to date');
  } else {
    writeFileSync(GENERATED_PATH, rendered);
    const { runtime, fonts } = buildAttribution();
    console.log(
      `emit:attribution: wrote ${runtime.length} runtime dependencies and ${fonts.length} font families`,
    );
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  main();
}
