#!/usr/bin/env node
/**
 * Fail the build if anything secret-shaped reaches the browser.
 *
 * Everything in `apps/web/out` is public the moment it deploys. There is no such thing
 * as a private value in a client bundle, and the mistake is easy to make: a key pasted
 * into a component during debugging, a `.env` value read without the public prefix, a
 * config object spread wholesale into props. None of those look wrong in review.
 *
 * This is deliberately noisy about *shapes* rather than clever about context. A false
 * positive costs someone a minute and an allowlist entry; a false negative publishes a
 * credential to five million people.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KEY_FORMATS, SECRET_NAMED } from './credential-formats.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = join(root, 'apps', 'web', 'out');

/**
 * Environment variables that may reach the browser.
 *
 * Next only inlines `NEXT_PUBLIC_*`, which is the naming convention this enforces: a
 * variable without the prefix appearing in client output means someone read it somewhere
 * it does not belong.
 */
const PUBLIC_PREFIX = 'NEXT_PUBLIC_';

async function walk(dir, found = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, found);
    else found.push(path);
  }
  return found;
}

const SCANNED = new Set(['.js', '.mjs', '.cjs', '.html', '.json', '.css', '.txt', '.map', '.svg']);

const findings = [];

const files = await walk(out);
if (files.length === 0) {
  console.error('check-bundle-secrets: apps/web/out is empty — run `pnpm build` first');
  process.exitCode = 1;
} else {
  let scanned = 0;
  for (const path of files) {
    if (!SCANNED.has(extname(path))) continue;
    const { size } = await stat(path);
    // A 20MB source map is worth reading; a video is not.
    if (size > 40 * 1024 * 1024) continue;
    const text = await readFile(path, 'utf8');
    const relative = path.slice(out.length + 1);
    scanned += 1;

    for (const [pattern, what] of KEY_FORMATS) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({
          relative,
          what,
          // Never echo the value: this output goes to CI logs, which are themselves
          // often public. The prefix is enough to find it.
          hint: `${match[0].slice(0, 8)}…`,
        });
      }
    }

    const named = SECRET_NAMED.exec(text);
    if (named) {
      findings.push({
        relative,
        what: 'a secret-named assignment with a literal value',
        hint: `${named[0].slice(0, 24).replace(/["'].*/, '"…"')}`,
      });
    }

    // A non-public env var reaching the client means the naming convention was bypassed.
    for (const match of text.matchAll(/\bprocess\.env\.([A-Z][A-Z0-9_]{2,})\b/g)) {
      const name = match[1];
      if (name && !name.startsWith(PUBLIC_PREFIX) && name !== 'NODE_ENV') {
        findings.push({
          relative,
          what: `the non-public environment variable ${name} reaching client output`,
          hint: `only ${PUBLIC_PREFIX}* may be shipped`,
        });
      }
    }
  }
  console.log(`check-bundle-secrets: scanned ${String(scanned)} shipped file(s)`);
}

if (findings.length > 0) {
  console.error(`\ncheck-bundle-secrets: ${String(findings.length)} finding(s)\n`);
  for (const { relative, what, hint } of findings) {
    console.error(`  ✗ ${relative}`);
    console.error(`      contains ${what} (${hint})`);
  }
  console.error(
    '\nEverything in apps/web/out is public the moment it deploys. If this is a real\n' +
      'credential, rotate it now — it is already in your build output and may be in a\n' +
      'CI log. See docs/secret-rotation.md.',
  );
  process.exitCode = 1;
} else if (process.exitCode !== 1) {
  console.log('check-bundle-secrets: no credential-shaped strings in shipped output');
}
