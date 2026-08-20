#!/usr/bin/env node
/**
 * Rule 3: "Every asset needs an `assets.license.json` entry. CI enforces it."
 *
 * Nothing enforced it. There is no such file anywhere in the repository and no script
 * ever looked for one — the rule was true only because every game draws with primitives
 * and no binary asset has ever been committed. The moment one is, the rule would have
 * been broken silently, which is the worst possible time to discover the guard is
 * imaginary. So: written now, while the answer is still zero.
 *
 * An asset is anything shipped that a person made rather than typed: images, audio,
 * video, fonts. Its licence entry must say where it came from and under what terms,
 * because rule 1 — original assets only — is a claim this repository has to be able to
 * back up file by file.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const ASSET_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.ico',
  '.svg',
  '.mp3',
  '.wav',
  '.ogg',
  '.m4a',
  '.aac',
  '.flac',
  '.opus',
  '.mp4',
  '.webm',
  '.mov',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
]);

/** Required on every entry. A licence nobody can check is not a licence. */
const REQUIRED_FIELDS = ['source', 'licence', 'author'];

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const assets = tracked.filter((file) => ASSET_EXTENSIONS.has(extname(file).toLowerCase()));

/**
 * A manifest covers the directory it sits in and everything under it, so a package can
 * license its own assets and the repository can hold one for anything shared.
 */
function manifestsFor(file) {
  const found = [];
  let dir = dirname(join(ROOT, file));
  const stop = dirname(ROOT);
  while (dir !== stop && dir.startsWith(ROOT)) {
    const candidate = join(dir, 'assets.license.json');
    if (existsSync(candidate)) found.push(candidate);
    dir = dirname(dir);
  }
  const rootManifest = join(ROOT, 'assets.license.json');
  if (existsSync(rootManifest) && !found.includes(rootManifest)) found.push(rootManifest);
  return found;
}

const failures = [];

for (const asset of assets) {
  const manifests = manifestsFor(asset);
  if (manifests.length === 0) {
    failures.push(`${asset} — no assets.license.json covers it`);
    continue;
  }

  let entry = null;
  let manifestPath = null;
  for (const manifest of manifests) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(manifest, 'utf8'));
    } catch (error) {
      failures.push(`${relative(ROOT, manifest)} is not valid JSON: ${String(error)}`);
      continue;
    }
    const entries = Array.isArray(parsed) ? parsed : (parsed.assets ?? []);
    const wanted = relative(dirname(manifest), join(ROOT, asset));
    const match = entries.find(
      (candidate) => candidate?.file === wanted || candidate?.file === asset,
    );
    if (match) {
      entry = match;
      manifestPath = manifest;
      break;
    }
  }

  if (!entry) {
    failures.push(
      `${asset} — shipped but not listed in ${manifests.map((m) => relative(ROOT, m)).join(' or ')}`,
    );
    continue;
  }

  const missing = REQUIRED_FIELDS.filter((field) => {
    const value = entry[field];
    return typeof value !== 'string' || value.trim() === '';
  });
  if (missing.length > 0) {
    failures.push(
      `${asset} — its entry in ${relative(ROOT, manifestPath)} has no ${missing.join(', ')}`,
    );
  }
}

console.log(
  `check-asset-licenses: ${String(assets.length)} asset file(s) tracked` +
    (assets.length === 0
      ? ' — nothing to license yet, and the guard is in place for when there is'
      : ''),
);

if (failures.length > 0) {
  console.error('\ncheck-asset-licenses: unlicensed assets\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    '\nRule 1 is original assets only, and rule 3 is that every one of them says so in\n' +
      'an assets.license.json entry with a source, a licence and an author.',
  );
  process.exit(1);
}
console.log('check-asset-licenses: every asset is accounted for');
