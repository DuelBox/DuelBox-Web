/**
 * The three files that make up the framed notice, held against each other.
 *
 * `app/frame-guard.ts` decides and stamps `data-framed`; `app/globals.css` reveals
 * `#db-framed`; `app/layout.tsx` renders it. The split exists for size (#2545) — the guard
 * script is serialised into all 108 route payloads and the stylesheet is fetched once — and
 * splitting a defence across three files is exactly how one of them comes to disagree with
 * the others without anything failing.
 *
 * Every assertion here was watched failing: the id renamed in the CSS, the attribute changed
 * in the guard, the `display: none` deleted, and the notice taken out of the layout. The
 * behavioural half — a real page in a real iframe — is `e2e/frame-guard.spec.ts`, which is
 * what catches a browser disagreeing with the reading below.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FRAMED_ATTRIBUTE,
  FRAMED_NOTICE_ID,
  FRAMED_NOTICE_LINK,
  FRAMED_NOTICE_TEXT,
  FRAME_GUARD,
} from './frame-guard';

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
const layout = read('./layout.tsx');
// Comments stripped before any rule below is matched. A declaration block is read as
// "everything to the next `}`", and one of these very rules explains itself by quoting
// `html{visibility:hidden!important}` — so the first draft of this file matched a block that
// ended inside a comment and reported the palette missing from a rule that has it.
const globals = read('./globals.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the one rule that reveals the notice, comments already gone. */
function revealed(): string | undefined {
  const rule = new RegExp(`html\\[${FRAMED_ATTRIBUTE}\\]\\s+#${FRAMED_NOTICE_ID}\\s*\\{([^}]*)\\}`);
  return rule.exec(globals)?.[1];
}

describe('the notice a framed page shows', () => {
  it('is rendered by the layout, not built by the guard script', () => {
    // The reason it moved: bytes here are paid once per payload, bytes in the guard 108 times
    // — and a node the script appends after DOMContentLoaded is a node React does not own.
    expect(layout).toContain('FRAMED_NOTICE_ID');
    expect(layout).toContain('FRAMED_NOTICE_TEXT');
    expect(layout).toContain('FRAMED_NOTICE_LINK');
    expect(FRAME_GUARD).not.toContain(FRAMED_NOTICE_ID);
    expect(FRAME_GUARD).not.toContain('createElement("div")');
  });

  it('comes after the skip link, which is the first thing anybody must meet', () => {
    // Regression. Rendered beside the scripts at the top of the body — where it looks like it
    // belongs, next to the guard that reveals it — it became the first `a[href]` in the
    // document and `e2e/screen-reader.spec.ts` went red. `display: none` keeps it out of the
    // *tab* order and says nothing about a virtual cursor, and it is `position: fixed` when it
    // shows, so it can sit anywhere in the document without moving on screen.
    expect(layout.indexOf('id={FRAMED_NOTICE_ID}')).toBeGreaterThan(layout.indexOf('"db-skip"'));
  });

  it('links out of the frame with the current page, target and rel', () => {
    // `.` is this directory, and `trailingSlash: true` makes every route one — so this is the
    // page the visitor is on, resolved by the browser rather than interpolated from
    // `location.href` into markup by a script.
    expect(layout).toMatch(/href="\."/);
    expect(layout).toContain('target="_blank"');
    // `noopener` is not decoration here: the opener would be a document an attacker framed.
    expect(layout).toContain('rel="noopener"');
  });

  it('is hidden for everyone the guard has not refused', () => {
    expect(globals).toMatch(new RegExp(`#${FRAMED_NOTICE_ID}\\s*\\{[^}]*display:\\s*none`));
  });

  it('is revealed only under the attribute the guard stamps', () => {
    const body = revealed();
    expect(body).toBeDefined();
    // It has to beat `html{visibility:hidden!important}`, which the guard installs before any
    // stylesheet exists. Without the `!important` here the notice inherits the hiding and a
    // framed visitor is shown a blank page with no way out of it.
    expect(body).toMatch(/visibility:\s*visible\s*!important/);
    expect(body).toMatch(/display:\s*block/);
    expect(body).toMatch(/position:\s*fixed/);
  });

  it('takes its colours from the palette rather than spelling them again', () => {
    // The old guard carried `background:#fff;color:#111` because it ran before any stylesheet
    // existed. In a stylesheet the tokens are available, and `styles/tokens.test.ts` is the
    // rule that says a raw hex is not.
    const body = new RegExp(
      `html\\[${FRAMED_ATTRIBUTE}\\]\\s+#${FRAMED_NOTICE_ID}\\s*\\{([^}]*)\\}`,
    ).exec(globals)?.[1];
    expect(body).toContain('var(--db-paper)');
    expect(body).toContain('var(--db-ink)');
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('says both halves: what happened, and what to press', () => {
    expect(FRAMED_NOTICE_TEXT).toMatch(/frame/i);
    expect(FRAMED_NOTICE_LINK).toMatch(/new tab/i);
  });
});
