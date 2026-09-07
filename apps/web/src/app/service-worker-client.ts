import { BASE_PATH } from './base-path';

/**
 * The page's half of the offline story: registration, the update prompt, and the offline
 * indicator.
 *
 * ## Why this is an inline script rather than a component
 *
 * Two reasons, and the second is the one that decided it.
 *
 * **It costs the shell nothing.** Rule 11 says nothing merges over the size budget, and the
 * shell is the number every visitor pays whether or not they ever go offline. A string in
 * the markup is not in any chunk: `scripts/check-size.mjs` measures the emitted JavaScript,
 * and this adds none of it. `emit-host-config.mjs` hashes it into each page's `script-src`
 * exactly as it already does for the frame guard, so the strict policy covers it without
 * being widened. The cost is HTML bytes, and they are reported in `docs/pwa.md` rather than
 * left unmeasured.
 *
 * **It has to work when the application does not.** This is the code that tells a person
 * their connection has gone and offers them the reload that fixes a bad worker. A version
 * of it that waits for a chunk to download and React to hydrate is unavailable in precisely
 * the conditions it exists for. The frame guard is inline for the same shape of reason.
 *
 * ## The contract with `apps/web/public/sw.js`
 *
 * One message, one direction: this posts `SKIP_WAITING` to a waiting worker when a person
 * presses Reload, and the worker calls `skipWaiting()`. Nothing else passes between them.
 * `service-worker-client.test.ts` asserts both halves still agree, because a prompt whose
 * button posts a message nothing listens for is a button that does nothing, and it would
 * look completely fine in review.
 *
 * ## What it never does
 *
 * It does not decide *when* to prompt for installation — that is #195, and it needs a
 * policy about interrupting a player mid-match rather than a `beforeinstallprompt`
 * listener. It does not download anything. Registration is scheduled on `load`, after the
 * page is usable, so nothing here competes with the first paint of a game.
 */

/**
 * Terse for the same reason `FRAME_GUARD` is: this ships in the markup of every page rather
 * than through a minifier. The reasoning lives above, where it costs nothing.
 *
 * `data-net` on `<html>` is set during parse, before anything paints, so a page restored
 * from cache with no connection is already styled as offline rather than flashing — the same
 * arrangement `html[data-match='live']` already uses, an attribute on the document and the
 * rules in the stylesheet.
 *
 * The banner is a DOM node, and that is why it is created on `load` and never during parse.
 * This script is the first thing in `<body>`; a node appended there mid-parse becomes the
 * second child of a body React is about to hydrate, and an unexpected child at that position
 * is a hydration mismatch. After `load` it is a trailing node appended to a body React has
 * already claimed, which is the same thing every third-party script on the web does and
 * which React 19 handles. So: the attribute immediately, the element later.
 */
export const SERVICE_WORKER_CLIENT = [
  '(function(){var n=navigator,d=document,e=d.documentElement,w=window;',
  'if(!("serviceWorker" in n))return;',
  'function bar(i,t,l,g){var b=d.getElementById(i);if(b)return;',
  'b=d.createElement("div");b.id=i;b.className="db-net-bar";',
  'b.setAttribute("role","status");b.setAttribute("aria-live","polite");',
  'var s=d.createElement("span");s.textContent=t;b.appendChild(s);',
  'if(l){var k=d.createElement("button");k.type="button";k.className="db-net-do";',
  'k.textContent=l;k.addEventListener("click",g);b.appendChild(k);}d.body.appendChild(b);}',
  'function drop(i){var b=d.getElementById(i);if(b)b.remove();}',
  'function net(x){var on=n.onLine!==false;e.dataset.net=on?"online":"offline";if(!x)return;',
  'if(on)drop("db-offline");',
  'else bar("db-offline","Offline. The games you have already played are still here.");}',
  'net(0);',
  'var asked=false;',
  'function update(r){bar("db-update","A new version of DuelBox is ready.","Reload",',
  'function(){asked=true;if(r.waiting)r.waiting.postMessage("SKIP_WAITING");',
  'else w.location.reload();});}',
  'function ready(r){var i=r.installing;if(!i)return;',
  'i.addEventListener("statechange",function(){',
  'if(i.state==="installed"&&n.serviceWorker.controller)update(r);});}',
  'function saved(){if(!w.caches)return;w.caches.keys().then(function(k){',
  'return Promise.all(k.filter(function(c){return c.indexOf("duelbox-")===0;})',
  '.map(function(c){return w.caches.open(c).then(function(o){return o.keys();});}));})',
  '.then(function(l){var h={};l.forEach(function(q){q.forEach(function(r){',
  'h[new URL(r.url).pathname]=1;});});var m=d.getElementById("main");if(!m)return;',
  'm.querySelectorAll("a[href]").forEach(function(a){',
  'var u=new URL(a.href,w.location.href).pathname;',
  'if(/^\\/(?:[^/]+\\/)?(play|games)\\/[^/]+\\/$/.test(u))a.dataset.offlineReady=h[u]?"1":"0";});})',
  '.catch(function(){});}',
  'function shown(){net(1);}w.addEventListener("online",shown);',
  'w.addEventListener("offline",shown);',
  'w.addEventListener("load",function(){shown();',
  `n.serviceWorker.register("${BASE_PATH}/sw.js",{scope:"${BASE_PATH}/"}).then(function(r){`,
  'if(r.waiting&&n.serviceWorker.controller)update(r);',
  'r.addEventListener("updatefound",function(){ready(r);});',
  'if(r.active)saved();else n.serviceWorker.ready.then(saved);',
  '}).catch(function(){});',
  'n.serviceWorker.addEventListener("controllerchange",function(){',
  'if(!asked)return;asked=false;w.location.reload();});});})()',
].join('');
