/**
 * The clickjacking defence for a host that serves no response headers.
 *
 * ## Why this is script rather than a header
 *
 * Framing is refused by exactly two mechanisms, `X-Frame-Options` and CSP `frame-ancestors`,
 * and **both are response headers only**. `<meta http-equiv="X-Frame-Options">` has never
 * been honoured by any browser, and `frame-ancestors` is one of the handful of directives a
 * meta policy is defined to ignore. The build generates both — see
 * `scripts/security-headers.mjs` — and the host the site deploys to (GitHub Pages) sends
 * neither, so today *nothing declarative* stops any page on the internet framing this one.
 * `scripts/header-delivery.mjs` is where that is recorded and machine-checked.
 *
 * ## What this buys, and what it does not
 *
 * Buys: a framed page is invisible and unclickable before it paints, so an attacker has
 * nothing to overlay and a victim has nothing to click. That is the substance of the
 * clickjacking defence.
 *
 * Does not buy: anything at all when script does not run. `<iframe sandbox>` without
 * `allow-scripts` renders the page and disables its JavaScript, and that iframe is written
 * by the attacker. Framed content is also still *loaded*, so this is not a substitute for
 * `frame-ancestors` and #2367's threat model must not be written as though it were. It is a
 * mitigation of the top risk, not a replacement for the header.
 *
 * ## Why it hides through a stylesheet rather than rewriting the document
 *
 * The obvious version — blank the body, then put a notice in it — is defeated by the
 * framework it ships inside. Next hydrates the whole document; a body whose children have
 * been replaced is a hydration mismatch, and React 19 recovers from a mismatch by
 * client-rendering the tree again, which puts the application back. The page would go dark
 * for a moment and then return, framed and clickable, with nothing in any log to say so.
 *
 * So the hiding lives somewhere React does not reconcile: a `<style>` element this script
 * appends to the head, holding one `!important` rule against `<html>`. React may re-render
 * the entire body underneath it; the rule still applies, and an inline `style` React writes
 * cannot outrank `!important`. `visibility` rather than `display` because a hidden subtree
 * takes no hit-testing — nothing in it can be clicked — while still allowing one descendant
 * to make itself visible again, which is how the notice appears.
 *
 * The notice is therefore the only part that can be lost, and losing it fails *safe*: the
 * page stays invisible and the visitor sees a blank frame rather than a live one.
 *
 * ## Why it busts unconditionally
 *
 * Because there is nothing to exempt. #2367 proposes an embed route; it is unbuilt and
 * unscheduled before M4, and nothing under `apps/web/src` renders, serves or documents an
 * embeddable surface today — no `/embed` route, no `postMessage` listener, no `<iframe>`
 * outside a test fixture. Busting unconditionally therefore breaks no supported use.
 *
 * When the embed route does land, the exemption goes here as a **path** allowlist, not an
 * origin one: a framed page cannot read its embedder's origin (that is the whole point of
 * the same-origin policy), so the only origin allowlist that means anything is
 * `frame-ancestors` in a response header — which is another reason #2367 needs the host
 * moved rather than more script.
 */

/**
 * Deliberately terse, because this string ships in the markup of every page rather than in
 * a chunk the bundler minifies. The reasoning is in the comment above, where it costs
 * nothing; the code below is what a browser has to read.
 *
 * The first line is the whole defence and it runs synchronously, during parse, before
 * anything is painted. Everything after it is the readable notice, which waits for the
 * document because it needs a `<body>` to attach to — by then the page is already hidden
 * and the race that matters is over.
 */
export const FRAME_GUARD = [
  '(function(){var w=window;if(w.top===w.self)return;var d=w.document,s=d.createElement("style");',
  's.textContent="html{visibility:hidden!important}#db-framed{visibility:visible!important;',
  'position:fixed;inset:0;background:#fff;color:#111;font:1rem/1.5 system-ui,sans-serif;padding:2rem}";',
  '(d.head||d.documentElement).appendChild(s);',
  'd.addEventListener("DOMContentLoaded",function(){',
  'var n=d.createElement("div");n.id="db-framed";',
  'var a=d.createElement("a");a.href=w.location.href;a.target="_blank";a.rel="noopener";',
  'a.textContent="Open DuelBox in a new tab";',
  'n.append("DuelBox does not run inside a frame. ",a);d.body.appendChild(n)})})()',
].join('');
