#!/usr/bin/env node
/**
 * Render the security headers into the files each static host actually reads, and drop
 * `security.txt` alongside them.
 *
 * ## Why this is a build step rather than a config file
 *
 * `output: 'export'` means there is no server runtime, so `next.config.ts`'s `headers()`
 * does nothing — Next says so, and it is easy to add anyway and believe you are protected.
 * The origin's headers are the host's business, and every host spells them differently:
 * Netlify and Cloudflare Pages read `_headers`, Vercel reads `vercel.json`, everything
 * else wants a server block. Written by hand three times they drift, and the drift is
 * invisible until a scanner finds HSTS on one host and not another.
 *
 * ## Why `script-src` is computed
 *
 * Issue #2369 asks for a strict CSP **with nonces**. A nonce has to be different on every
 * response, which requires something to be running at request time. Nothing is: the whole
 * point of this product is that the origin hands over files and stops. So a nonce is not
 * merely inconvenient here, it is unavailable, and a CSP claiming to use one would be
 * decorative.
 *
 * The static-export answer is hashes. Next's exported HTML carries inline bootstrap
 * scripts; this walks every emitted page, hashes each inline script with SHA-256, and
 * writes the union into `script-src`. That is as strong as a nonce against injected
 * script — an attacker who gets a `<script>` into the page cannot make its hash match —
 * and unlike a nonce it can be verified after the fact by re-running the build.
 *
 * **Without `'strict-dynamic'`, and that is not an oversight.** It reads as the natural
 * companion to a hash — trust what the trusted script loads — but in CSP 3 it *disables*
 * `'self'` and every host expression, and Next's exported HTML loads its chunks through
 * ordinary `<script src>` tags that no hashed script put there. The policy would have
 * blocked the entire application while looking stricter and more modern. Plain `'self'`
 * admits the same-origin chunks, the hashes admit the inline bootstrap, and nothing else
 * runs.
 *
 * ## Why the hashed CSP travels in the page rather than in a header
 *
 * Two attempts failed before this one, and both failed on size.
 *
 * One header for the whole site came out at 687 hashes and roughly 45 KB, because Next
 * inlines its flight data per route and there are a hundred-odd routes. That is past what
 * nginx (8 KB) and Cloudflare (16 KB) will carry, and an over-long header is *dropped*
 * rather than rejected — worse than absent, because it looks configured.
 *
 * A path-scoped rule per page fixed the width (4.8 KB at the widest) and produced 150
 * rules, over the 100 that Cloudflare Pages accepts in a `_headers` file.
 *
 * So the hashed policy goes into each page as a `<meta http-equiv>`, which has no size
 * limit and — the part that matters beyond this issue — **needs no host configuration at
 * all**. The policy travels with the file, so it is identical on Netlify, on Vercel, on
 * GitHub Pages, and on a bucket with static hosting switched on. That is issue #2455's
 * requirement met by construction rather than by writing four config files and hoping.
 *
 * `frame-ancestors` cannot be expressed in a meta tag, so it stays in the header set along
 * with `X-Frame-Options`, which is its legacy equivalent and covers the browsers that
 * ignore it. The header CSP deliberately carries **no `script-src`**: a header and a meta
 * policy are both enforced and the result is their intersection, so a header saying
 * `script-src 'self'` would silently override every hash the page just declared.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSP_STATIC_DIRECTIVES, headerEntries } from './security-headers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = join(root, 'apps', 'web', 'out');

/** Where a researcher should write. Also the owner named in SECURITY.md. */
const SECURITY_CONTACT = 'https://github.com/DuelBox/DuelBox-Web/security/advisories/new';
const SECURITY_POLICY = 'https://github.com/DuelBox/DuelBox-Web/blob/main/SECURITY.md';

/**
 * How long `security.txt` claims to be current.
 *
 * RFC 9116 requires an `Expires` in the future and recommends under a year. Taken from
 * the build's own timestamp rather than hard-coded, so it cannot quietly go stale — a
 * `security.txt` that expired eight months ago tells a researcher the project is
 * abandoned, which is worse than not having one.
 */
const EXPIRY_DAYS = 180;

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

/**
 * Every inline script in one page, hashed.
 *
 * Deliberately naive parsing: a `<script>` with no `src` is an inline script, and the
 * exported HTML is machine-generated so there is no cleverness to accommodate. If Next
 * ever emits something this misses, the CSP gets stricter and the page breaks loudly in
 * `pnpm e2e` — which is the failure mode to want.
 */
function inlineScriptHashes(html) {
  const hashes = new Set();
  const pattern = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const body = match[1];
    if (body === undefined || body.length === 0) continue;
    hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return [...hashes].sort();
}

/** `out/play/ping-pong/index.html` becomes `/play/ping-pong/`; `out/index.html` becomes `/`. */
function urlPathOf(file) {
  const relative = file.slice(out.length).split(sep).join('/');
  return relative.replace(/index\.html$/, '') || '/';
}

/** The policy that goes in the page: everything a meta tag can carry, hashes included. */
function buildPageCsp(hashes) {
  const directives = Object.entries(CSP_STATIC_DIRECTIVES)
    .filter(([name]) => !HEADER_ONLY_DIRECTIVES.has(name))
    .map(([name, value]) => (value === '' ? name : `${name} ${value}`));
  // `'self'` for the same-origin chunks, hashes for the inline bootstrap, and nothing
  // else. See the note at the top about why `'strict-dynamic'` is absent.
  directives.push(
    hashes.length === 0 ? "script-src 'self'" : `script-src 'self' ${hashes.join(' ')}`,
  );
  return directives.sort().join('; ');
}

/**
 * The policy that goes in the header: what a meta tag cannot express, and what it must not.
 *
 * Emphatically not the whole policy. A header CSP and a meta CSP are both enforced and the
 * browser applies the intersection, so anything named here in a weaker form than the page
 * declares would quietly win.
 *
 * - `frame-ancestors` is here because a meta tag cannot express it at all.
 * - `upgrade-insecure-requests` is here because a meta tag expresses it **too well**. Baked
 *   into the HTML it travels with the file to every origin the file is ever served from, and
 *   the exported site is served over plain HTTP in three of them: the local preview, the
 *   end-to-end suite, and a phone pointed at a laptop on the same network. Chromium exempts
 *   127.0.0.1 from the upgrade; **WebKit does not**, so on iOS Safari every chunk on the page
 *   was rewritten to `https://127.0.0.1:4173` and died with a TLS error, leaving the shell
 *   sitting on "Loading tic tac toe…" forever. The whole iPhone half of the e2e matrix
 *   failed that way, and each spec failed on a sixty-second timeout, which reads like a slow
 *   machine rather than a policy rewriting the URL.
 *
 *   As a *header* the directive still does its job — the host serving production over HTTPS
 *   sets it, and the file no longer carries the instruction anywhere else.
 */
const HEADER_ONLY_DIRECTIVES = new Set(['frame-ancestors', 'upgrade-insecure-requests']);

function buildHeaderCsp() {
  return Object.entries(CSP_STATIC_DIRECTIVES)
    .filter(([name]) => HEADER_ONLY_DIRECTIVES.has(name))
    .map(([name, value]) => (value === '' ? name : `${name} ${value}`))
    .sort()
    .join('; ');
}

/**
 * Put the policy in the page, immediately after `<head>`.
 *
 * Position is not cosmetic: a CSP in a meta tag governs only what follows it, so a tag
 * placed after the bootstrap script would permit the very thing it exists to constrain.
 */
function injectMetaCsp(html, csp) {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, '&quot;')}">`;
  if (html.includes('http-equiv="Content-Security-Policy"')) {
    return html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, tag);
  }
  const head = html.indexOf('<head>');
  if (head < 0) return null;
  return html.slice(0, head + '<head>'.length) + tag + html.slice(head + '<head>'.length);
}

/** Netlify and Cloudflare Pages. One rule, every path — well inside Cloudflare's 100. */
function renderHeadersFile(entries) {
  const lines = ['# Generated by scripts/emit-host-config.mjs — do not edit.', '', '/*'];
  for (const [name, value] of entries) lines.push(`  ${name}: ${value}`);
  return lines.join('\n') + '\n';
}

/** Vercel, and anything else reading its schema. */
function renderVercelJson(entries) {
  return (
    JSON.stringify(
      {
        $schema: 'https://openapi.vercel.sh/vercel.json',
        headers: [{ source: '/(.*)', headers: entries.map(([key, value]) => ({ key, value })) }],
      },
      null,
      2,
    ) + '\n'
  );
}

/**
 * Nginx, Apache and Caddy, for anybody serving the directory themselves.
 *
 * The generic rule only. A hand-run server wanting the per-page CSP should read `_headers`,
 * which has all of them; what a snippet is for is getting the eight fixed headers right in
 * thirty seconds, and those do not vary by page.
 */
function renderServerSnippets(entries) {
  const nginx = entries
    .map(([name, value]) => `  add_header ${name} "${value.replace(/"/g, '\\"')}" always;`)
    .join('\n');
  const apache = entries
    .map(([name, value]) => `  Header always set ${name} "${value.replace(/"/g, '\\"')}"`)
    .join('\n');
  const caddy = entries.map(([name, value]) => `    ${name} "${value}"`).join('\n');

  return `# Generated by scripts/emit-host-config.mjs — do not edit.
#
# The same header set as _headers and vercel.json, for hosts that want a server block.

## nginx
# server {
#   root /path/to/out;
${nginx
  .split('\n')
  .map((line) => `#${line}`)
  .join('\n')}
# }

## Apache (.htaccess, mod_headers)
# <IfModule mod_headers.c>
${apache
  .split('\n')
  .map((line) => `#${line}`)
  .join('\n')}
# </IfModule>

## Caddy
# duelbox.example {
#   root * /path/to/out
#   file_server
#   header {
${caddy
  .split('\n')
  .map((line) => `#${line}`)
  .join('\n')}
#   }
# }
`;
}

function renderSecurityTxt(nowMs) {
  const expires = new Date(nowMs + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return `# Generated by scripts/emit-host-config.mjs — do not edit.
# https://www.rfc-editor.org/rfc/rfc9116

Contact: ${SECURITY_CONTACT}
Expires: ${expires}
Policy: ${SECURITY_POLICY}
Preferred-Languages: en
`;
}

async function main() {
  const files = await walk(out);
  if (files.length === 0) {
    console.error('emit-host-config: apps/web/out is missing — run `pnpm build` first.');
    process.exitCode = 1;
    return;
  }

  const pages = files.filter((name) => name.endsWith('.html')).sort();
  let hashed = 0;
  let widestPolicy = 0;

  for (const page of pages) {
    const html = await readFile(page, 'utf8');
    const hashes = inlineScriptHashes(html);
    hashed += hashes.length;
    const csp = buildPageCsp(hashes);
    widestPolicy = Math.max(widestPolicy, csp.length);
    const injected = injectMetaCsp(html, csp);
    if (injected === null) {
      console.error(`emit-host-config: ${urlPathOf(page)} has no <head> to put the policy in`);
      process.exitCode = 1;
      return;
    }
    await writeFile(page, injected);
  }

  if (hashed === 0) {
    // Not fatal, but worth saying: it means either the export has no inline bootstrap or
    // the parse above stopped matching, and the two look identical from here.
    console.warn('emit-host-config: no inline scripts found — is the export complete?');
  }

  const entries = headerEntries(buildHeaderCsp());
  await writeFile(join(out, '_headers'), renderHeadersFile(entries));
  await writeFile(join(out, 'vercel.json'), renderVercelJson(entries));
  await writeFile(join(out, 'security-headers.conf.txt'), renderServerSnippets(entries));

  await mkdir(join(out, '.well-known'), { recursive: true });
  await writeFile(join(out, '.well-known', 'security.txt'), renderSecurityTxt(Date.now()));
  // Served at the root as well: RFC 9116 keeps the legacy location working, and some
  // hosts refuse to serve a dot-directory at all.
  await writeFile(join(out, 'security.txt'), renderSecurityTxt(Date.now()));

  const widestHeader = Math.max(...entries.map(([name, value]) => name.length + value.length));
  console.log(
    `emit-host-config: ${String(entries.length)} headers (widest ${String(widestHeader)} bytes), ` +
      `${String(pages.length)} pages carrying ${String(hashed)} inline-script hash(es) ` +
      `(widest policy ${String(widestPolicy)} bytes), security.txt written`,
  );
}

await main();
