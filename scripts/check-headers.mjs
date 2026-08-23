#!/usr/bin/env node
/**
 * Fail the build if a security header, or the policy in a page, has gone missing.
 *
 * Issue #2371 asks for exactly this: "a removed header fails CI rather than being noticed
 * later". Headers are the easiest thing in a codebase to delete by accident, because
 * nothing breaks when you do — the site keeps working, the tests keep passing, and the only
 * signal is a scanner nobody runs on a schedule.
 *
 * This reads the *emitted artefact*, not the source it was emitted from. Asserting that
 * `security-headers.mjs` contains what `security-headers.mjs` contains would pass happily
 * on a build where `emit-host-config.mjs` never ran.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECURITY_HEADERS } from './security-headers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = join(root, 'apps', 'web', 'out');

/** Directives that must be in every page's policy, whatever else it carries. */
const REQUIRED_DIRECTIVES = [
  "default-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
];

/**
 * The one directive that must never appear in `script-src`.
 *
 * `'unsafe-inline'` in `style-src` is deliberate and explained where it is set. In
 * `script-src` it would undo the entire point of hashing, and it is precisely the change
 * somebody makes at 6pm to get a build green.
 */
const FORBIDDEN_IN_SCRIPT_SRC = ["'unsafe-inline'", "'unsafe-eval'"];

async function walk(dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else found.push(full);
  }
  return found;
}

const failures = [];

function must(condition, message) {
  if (!condition) failures.push(message);
}

async function main() {
  const files = await walk(out);
  if (files.length === 0) {
    console.error('check-headers: apps/web/out is missing — run `pnpm build` first.');
    process.exitCode = 1;
    return;
  }

  // 1. Every fixed header, with its exact value, in the host config.
  let headers;
  try {
    headers = await readFile(join(out, '_headers'), 'utf8');
  } catch {
    console.error('check-headers: apps/web/out/_headers is missing — did emit:host-config run?');
    process.exitCode = 1;
    return;
  }

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    must(headers.includes(`${name}: ${value}`), `_headers is missing or has changed: ${name}`);
  }
  must(
    headers.includes("Content-Security-Policy: frame-ancestors 'self'"),
    '_headers is missing frame-ancestors, which a meta policy cannot express',
  );
  must(
    !/Content-Security-Policy:.*script-src/.test(headers),
    'the header policy names script-src; it would intersect with — and override — the ' +
      'hashed policy each page declares',
  );

  // 2. The same set in vercel.json, so the two hosts cannot drift apart.
  const vercel = await readFile(join(out, 'vercel.json'), 'utf8').catch(() => '');
  for (const name of Object.keys(SECURITY_HEADERS)) {
    must(vercel.includes(`"${name}"`), `vercel.json is missing: ${name}`);
  }

  // 3. Every page carries a policy, and it is a strict one.
  const pages = files.filter((name) => name.endsWith('.html'));
  must(pages.length > 0, 'the export contains no HTML at all');

  let hashedPages = 0;
  for (const page of pages) {
    const html = await readFile(page, 'utf8');
    const label = page.slice(out.length) || '/';
    const match = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html);
    if (match === null) {
      failures.push(`${label} carries no Content-Security-Policy`);
      continue;
    }
    const policy = match[1] ?? '';

    for (const directive of REQUIRED_DIRECTIVES) {
      must(policy.includes(directive), `${label} policy is missing: ${directive}`);
    }

    const scriptSrc = /script-src ([^;]*)/.exec(policy)?.[1] ?? '';
    must(scriptSrc.length > 0, `${label} policy has no script-src`);
    for (const forbidden of FORBIDDEN_IN_SCRIPT_SRC) {
      must(!scriptSrc.includes(forbidden), `${label} script-src contains ${forbidden}`);
    }
    if (scriptSrc.includes('sha256-')) hashedPages += 1;

    // The policy governs only what follows it, so a tag after the bootstrap permits the
    // very script it exists to constrain.
    const policyAt = html.indexOf('<meta http-equiv="Content-Security-Policy"');
    const firstScript = html.indexOf('<script');
    must(
      firstScript < 0 || policyAt < firstScript,
      `${label} declares its policy after the first script, which it therefore does not cover`,
    );
  }

  must(
    hashedPages > 0,
    'no page carries a hashed script-src — the inline-script parse has probably stopped matching',
  );

  // 4. security.txt, in both locations RFC 9116 recognises, and not expired.
  for (const location of ['security.txt', join('.well-known', 'security.txt')]) {
    const text = await readFile(join(out, location), 'utf8').catch(() => '');
    must(text.includes('Contact:'), `${location} is missing or has no Contact:`);
    const expires = /Expires: (.+)/.exec(text)?.[1];
    must(expires !== undefined, `${location} has no Expires:`);
    if (expires !== undefined) {
      must(
        Date.parse(expires) > Date.now(),
        `${location} expired on ${expires} — a stale one says the project is abandoned`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(`check-headers: ${String(failures.length)} problem(s)\n`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `check-headers: ${String(Object.keys(SECURITY_HEADERS).length)} headers, ` +
      `${String(pages.length)} pages with a policy (${String(hashedPages)} hashed), ` +
      'security.txt current',
  );
}

await main();
