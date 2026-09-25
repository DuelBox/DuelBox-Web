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
 *
 * ## And that is still the wrong assertion on its own
 *
 * Everything above proves the *file* is right. It cannot prove anybody reads the file, and
 * on GitHub Pages nobody does — Pages serves no custom response headers, so `_headers` and
 * `vercel.json` are both inert and every header this script has just confirmed reaches no
 * visitor at all. A guard green about the wrong thing is this repository's signature
 * failure and this was an instance of it.
 *
 * So section 5 asserts the inverse, from `scripts/header-delivery.mjs`: every generated
 * header must be classified by *how it is delivered*, the declared deploy target must still
 * match what `deploy.yml` actually does, and the two things that survive a header-less host
 * — the meta CSP and the meta referrer policy — must be present in every page along with
 * the frame guard that partly stands in for the `X-Frame-Options` nobody serves. Then the
 * served-versus-discarded table is printed, on every build, in plain words.
 *
 * ## Section 6 asks a different question of the same files
 *
 * Caching (#188) cannot be checked by name and value the way a security header can, because
 * what matters is not that `_headers` contains the word `immutable` but *which files get it*
 * — and the answer to that is a question about the export, not about the config. So section 6
 * resolves rather than greps: every exported file is matched against the rules the emit
 * actually wrote, in `_headers` and in `vercel.json`, and three things have to hold. Every
 * file the immutable rule reaches must carry a hash in its name, so the promise never to
 * revalidate is one the export can keep. Nothing outside `_next/static/` may be reached by it.
 * And no path may be matched by two `Cache-Control` rules, because Cloudflare joins those
 * values rather than resolving them, which is how a file can carry the right rule and the
 * wrong header. `scripts/cache-headers.mjs` has the reasoning and the quotes.
 *
 * ## What even that cannot tell you
 *
 * That a header reached a browser. Every section here checks that the *files* say the right
 * thing — the inverse assertion included, which reads the artefact and the workflow, not the
 * live origin. A green step named "check headers" reads like a live-site guarantee and is
 * not one: only `curl -sI` against the origin can say a header arrived, which is the
 * verification step in `docs/deploy.md`. Issue #2481 tracks the choice between moving to a
 * host that reads `_headers` and accepting the gap knowingly.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECURITY_HEADERS } from './security-headers.mjs';
import {
  CACHE_RULES,
  HASHED_ASSET_PREFIX,
  HASHED_FILENAME,
  IMMUTABLE_CACHE_CONTROL,
  REVALIDATE_CACHE_CONTROL,
  SERVICE_WORKER_PATH,
  cachingRulesFor,
  globToRegExp,
  isContentAddressed,
  parseHeadersFile,
  parseVercelJson,
  sourceToRegExp,
} from './cache-headers.mjs';
import {
  DEPLOY_TARGET,
  FRAME_GUARD_MARKER,
  HOSTS,
  classificationProblems,
  detectDeployTarget,
  formatDeliveryReport,
  metaEquivalents,
} from './header-delivery.mjs';

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

/** Seconds, or `Infinity` when a value carries no `max-age` at all and so bounds nothing. */
function maxAgeOf(value) {
  const seconds = /max-age=(\d+)/.exec(value)?.[1];
  return seconds === undefined ? Infinity : Number(seconds);
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
  must(
    headers.includes('upgrade-insecure-requests'),
    '_headers is missing upgrade-insecure-requests, which is where it belongs — see below',
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
  /** Kept so section 5 can ask the same pages about delivery without re-reading 150 files. */
  const pageText = new Map();
  for (const page of pages) {
    const html = await readFile(page, 'utf8');
    pageText.set(page, html);
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

    // A meta policy travels with the file to every origin it is ever served from, and the
    // export is served over plain HTTP by the local preview, the e2e suite and any phone
    // pointed at a laptop. WebKit does not exempt 127.0.0.1 from the upgrade the way
    // Chromium does, so this one directive in the page rewrote every chunk URL to https and
    // took out the entire iPhone half of the e2e matrix — as sixty-second timeouts, which
    // look like a busy machine rather than a policy. It belongs in the header.
    must(
      !policy.includes('upgrade-insecure-requests'),
      `${label} declares upgrade-insecure-requests in the page; it breaks every plain-HTTP ` +
        'origin on WebKit and belongs in the response header',
    );

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

  // 5. The inverse assertion: what this host actually delivers.
  //
  // Sections 1–4 prove the artefact is right. This one is about whether anything reads it.

  // 5a. Nothing may be added to the generated set without saying how it travels. This is the
  //     check that stops the gap going back to being a comment: add a header to
  //     `security-headers.mjs`, and the build refuses it until it is classified.
  for (const problem of classificationProblems()) failures.push(problem);

  // 5b. The declared deploy target must still be what the workflow does. Move the deploy and
  //     every "reaches nobody" below becomes a lie; this is what makes that impossible to do
  //     quietly.
  const workflow = await readFile(join(root, '.github', 'workflows', 'deploy.yml'), 'utf8').catch(
    () => '',
  );
  const actual = detectDeployTarget(workflow);
  must(
    actual === DEPLOY_TARGET,
    `.github/workflows/deploy.yml deploys to ${actual ?? 'a host this check does not recognise'}` +
      `, but scripts/header-delivery.mjs says ${DEPLOY_TARGET} — re-classify which headers are ` +
      'served before the report below starts lying',
  );

  // 5c. On a host that serves no response headers, the meta equivalents are the delivery.
  //     Assert them in the artefact for the same reason the headers are asserted there: the
  //     source having them proves nothing about a build where the emit did not run.
  const host = HOSTS[DEPLOY_TARGET];
  if (host !== undefined && !host.servesResponseHeaders) {
    for (const { header, tag } of metaEquivalents()) {
      if (header === 'Content-Security-Policy') continue; // covered page-by-page above
      const missing = pages.filter((page) => !pageText.get(page)?.includes(tag));
      must(
        missing.length === 0,
        `${String(missing.length)} page(s) carry no ${header} meta tag, which on ${host.label} ` +
          `is the only way it reaches anyone — first: ${missing[0]?.slice(out.length) ?? '?'}`,
      );
    }

    // `X-Frame-Options` and CSP `frame-ancestors` are both header-only and both discarded
    // here, so the frame guard is the entire clickjacking defence. If it is not in the page,
    // there is none — and the table below would still print "partly mitigated".
    // After a literal `<script>`: the same source also appears, JSON-escaped and inert, in
    // the RSC flight payload of every page. See the note on FRAME_GUARD_MARKER.
    const guardTag = `<script>${FRAME_GUARD_MARKER}`;
    const unguarded = pages.filter((page) => !pageText.get(page)?.includes(guardTag));
    must(
      unguarded.length === 0,
      `${String(unguarded.length)} page(s) ship without the frame guard, and on ${host.label} ` +
        'nothing else refuses framing — first: ' +
        `${unguarded[0]?.slice(out.length) ?? '?'}`,
    );
  }

  // 6. Caching (#188), and this one is *resolved* rather than grepped.
  //
  // `_headers` containing the string `immutable` proves nothing about which files get it, and
  // the two ways this goes wrong are both invisible to a grep: a pattern that reaches past
  // `_next/static/` and puts a year on a document, and a second rule overlapping the first,
  // which on Cloudflare is joined rather than resolved and leaves `max-age=0` first in the
  // value. So every file in the export is matched against the rules the emit actually wrote,
  // in both files, and the claim `immutable` makes is checked against the export itself:
  // a file whose name does not carry its content has no business being cached for a year.
  const buildId = await readFile(join(root, 'apps', 'web', '.next', 'BUILD_ID'), 'utf8')
    .then((text) => text.trim())
    .catch(() => '');
  const nextConfig = await readFile(join(root, 'apps', 'web', 'next.config.ts'), 'utf8').catch(
    () => '',
  );

  const hostFiles = [
    { label: '_headers', rules: parseHeadersFile(headers), toRegExp: globToRegExp },
    { label: 'vercel.json', rules: parseVercelJson(vercel), toRegExp: sourceToRegExp },
  ];

  /** The URLs a browser actually asks for, which are not all of them file paths. */
  const DOCUMENT_URLS = ['/', '/play/tic-tac-toe/', '/index.txt', '/manifest.webmanifest'];

  const urlPaths = files.map((file) => file.slice(out.length).split(sep).join('/'));
  const hashedAssets = urlPaths.filter((urlPath) => urlPath.startsWith(HASHED_ASSET_PREFIX));
  const buildIdFiles = hashedAssets.filter(
    (urlPath) => !HASHED_FILENAME.test(urlPath.split('/').pop() ?? ''),
  ).length;

  for (const { label, rules, toRegExp } of hostFiles) {
    must(
      rules.length <= 100,
      `${label} has ${String(rules.length)} rules; Cloudflare accepts 100 in a _headers file`,
    );
    must(
      rules.some((rule) => rule.value === IMMUTABLE_CACHE_CONTROL),
      `${label} carries no immutable rule — hashed assets are revalidated on every visit, ` +
        'which is the thing #188 exists to stop',
    );

    const overlaps = [];
    const cacheControl = (urlPath) => {
      const matched = cachingRulesFor(rules, urlPath, toRegExp);
      if (matched.length > 1) {
        overlaps.push(`${urlPath} (${matched.map((rule) => rule.path).join(', ')})`);
      }
      return matched[0]?.value ?? null;
    };

    // Counted rather than reported one by one: there are 177 hashed assets and 700-odd
    // files, and a rule deleted by accident is one mistake, not seven hundred.
    const notImmutable = [];
    const notAddressed = [];
    const wronglyImmutable = [];
    for (const urlPath of urlPaths) {
      const value = cacheControl(urlPath);
      if (urlPath.startsWith(HASHED_ASSET_PREFIX)) {
        if (value !== IMMUTABLE_CACHE_CONTROL)
          notImmutable.push(`${urlPath} → ${value ?? 'no rule'}`);
        if (!isContentAddressed(urlPath.slice(HASHED_ASSET_PREFIX.length), buildId)) {
          notAddressed.push(urlPath);
        }
        continue;
      }
      if (value !== null && value.includes('immutable')) wronglyImmutable.push(urlPath);
    }

    must(
      notImmutable.length === 0,
      `${label}: ${String(notImmutable.length)} of ${String(hashedAssets.length)} hashed ` +
        'asset(s) do not resolve to the immutable rule, so a repeat visit revalidates them — ' +
        `first: ${notImmutable[0] ?? '?'}`,
    );
    must(
      notAddressed.length === 0,
      `${label}: ${String(notAddressed.length)} file(s) under ${HASHED_ASSET_PREFIX} are cached ` +
        'for a year and immutably while carrying neither a content hash nor this build id in ' +
        'the name, so the next deploy can serve different bytes from a URL a browser has been ' +
        `told never to ask about again — first: ${notAddressed[0] ?? '?'}`,
    );
    must(
      wronglyImmutable.length === 0,
      `${label}: ${String(wronglyImmutable.length)} file(s) outside ${HASHED_ASSET_PREFIX} are ` +
        'cached immutably; their URLs outlive their bytes, so a deploy would be invisible to ' +
        `anybody already holding one — first: ${wronglyImmutable[0] ?? '?'}`,
    );

    // The classes the issue names, asked as URLs rather than as files.
    const worker = cacheControl(SERVICE_WORKER_PATH);
    must(
      worker !== null && !worker.includes('immutable') && maxAgeOf(worker) <= 600,
      `${label}: ${SERVICE_WORKER_PATH} resolves to ${worker ?? 'no rule'}. It is the only ` +
        'signal a device that already has the site gets that a new build exists, so a long ' +
        'lifetime there strands every returning visitor on a build you have deleted',
    );
    for (const urlPath of DOCUMENT_URLS) {
      const value = cacheControl(urlPath);
      must(
        value === null || value === REVALIDATE_CACHE_CONTROL,
        `${label}: ${urlPath} resolves to ${value ?? 'no rule'}, which is neither absent nor ` +
          `"${REVALIDATE_CACHE_CONTROL}" — it is a document, and its bytes change every deploy`,
      );
    }

    // The finding this whole arrangement is shaped around, asserted rather than remembered.
    must(
      overlaps.length === 0,
      `${label}: ${String(overlaps.length)} path(s) are matched by two Cache-Control rules — ` +
        `first: ${overlaps[0] ?? '?'}. Cloudflare joins the values of two matching rules with ` +
        'a comma rather than letting the specific one win, and a recipient reads the first ' +
        'max-age it meets, so an overlap does not look untidy — it disables the rule that was ' +
        'meant to apply. Make them disjoint; see scripts/cache-headers.mjs',
    );
  }

  // `_headers` says it in the file, so a reader of the artefact alone can see both classes.
  for (const rule of CACHE_RULES) {
    must(
      headers.includes(`${rule.path}\n  Cache-Control: ${rule.value}`),
      `_headers has lost the rule for ${rule.path} — did emit:host-config run?`,
    );
  }

  // The build-id exception is safe only while the id is Next's per-build random string. Pin
  // it and those two URLs become stable across deploys with a year of immutability on them.
  must(
    buildIdFiles === 0 || !/generateBuildId/.test(nextConfig),
    `${String(buildIdFiles)} file(s) under ${HASHED_ASSET_PREFIX} have no hash in the name and ` +
      'are cached immutably only because the build id above them is fresh on every build. ' +
      'next.config.ts now sets generateBuildId, which makes that URL stable across deploys — ' +
      'either drop the pin or stop serving that directory immutably',
  );

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
  console.log(
    `check-headers: ${String(hashedAssets.length)} hashed asset(s) cached for a year and ` +
      `immutably (${String(buildIdFiles)} by build id rather than by filename), ` +
      `${String(urlPaths.length - hashedAssets.length)} file(s) revalidating, no rule overlaps`,
  );
  console.log('');
  console.log(formatDeliveryReport());
}

await main();
