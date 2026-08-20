#!/usr/bin/env node
/**
 * Fail if a credential is committed to the repository itself.
 *
 * `check-bundle-secrets.mjs` scans what ships. This scans what is *tracked*, which is a
 * different risk with a different blast radius: a key in the source is in the history for
 * ever, is visible to everyone who clones, and survives every rebuild. A key that never
 * reaches a bundle is still a key that has been published.
 *
 * The two scripts share their credential formats deliberately — one list, two places it
 * must not appear — and this one asks `git` for the file list so anything ignored, built
 * or installed is out of scope by construction rather than by an exclusion list that
 * drifts.
 *
 * It is deliberately noisy about *shapes* rather than clever about context. A false
 * positive costs a minute and an allowlist entry; a false negative publishes a credential.
 */

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KEY_FORMATS, SECRET_NAMED } from './credential-formats.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/** Binary and generated files a text scan cannot say anything useful about. */
const SKIP_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.mp3',
  '.wav',
  '.ogg',
  '.mp4',
  '.webm',
  '.pdf',
  '.zip',
  '.lock',
]);

/**
 * Files allowed to contain something secret-shaped, with the reason.
 *
 * The two scanners themselves carry every pattern they look for, which is exactly the
 * shape they are looking for. Nothing else is on this list, and adding to it should feel
 * uncomfortable.
 */
const ALLOWED = new Map([
  ['scripts/check-bundle-secrets.mjs', 'the shipped-output scanner'],
  ['scripts/check-source-secrets.mjs', 'this scanner'],
  ['scripts/credential-formats.mjs', 'the shared list of formats'],
]);

function trackedFiles() {
  // `git ls-files` is the authority on what is committed. Anything ignored, built or
  // installed is out of scope by construction rather than by an exclusion list.
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  return output.split('\0').filter((path) => path.length > 0);
}

const findings = [];

for (const relative of trackedFiles()) {
  if (SKIP_EXTENSIONS.has(extname(relative).toLowerCase())) continue;
  if (ALLOWED.has(relative)) continue;

  let text;
  try {
    text = await readFile(join(root, relative), 'utf8');
  } catch {
    // A path in the index that is not on disk right now is not this script's problem.
    continue;
  }

  for (const [pattern, what] of KEY_FORMATS) {
    const match = pattern.exec(text);
    if (match) findings.push(`${relative}: ${what}`);
  }
  if (SECRET_NAMED.test(text)) {
    findings.push(`${relative}: something named like a secret, assigned a literal`);
  }
}

const scanned = trackedFiles().length;
if (findings.length > 0) {
  console.error('check-source-secrets: credentials committed to the repository\n');
  for (const finding of findings) console.error(`  ${finding}`);
  console.error(
    '\nA key in the source is in the history for ever. Rotate it first, then remove it.',
  );
  process.exit(1);
}

console.log(`check-source-secrets: scanned ${String(scanned)} tracked file(s)`);
console.log('check-source-secrets: no credentials committed');
