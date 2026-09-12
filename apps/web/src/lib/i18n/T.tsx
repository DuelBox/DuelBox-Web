'use client';

import { Fragment, type ReactNode } from 'react';
import { useMessages } from './use-messages';

/**
 * A translated string as an element, for copy with markup in it and for server components
 * (#219).
 *
 * `t()` is a function and needs a catalogue, which only a client component can read from the
 * context. A server component has neither, and most of this site's copy is in server
 * components — the landing page, the catalogue, every game's page — which is where the bytes
 * argument matters most. `<T id="…" />` is how those translate: the server component passes the
 * English text as a prop, React serialises the element into the route payload and renders its
 * English into the HTML, and on the client this component looks the id up in the catalogue like
 * any other. **The English lands in the HTML and the flight payload, where server-rendered text
 * already lives today, and not in any JavaScript chunk** — checked on the built export rather
 * than assumed: the settings page's heading goes through this component and the string
 * `Sound, vibration, and what this device remembers` appears in `settings/index.html` and
 * `settings/index.txt` and in no file under `_next/static/chunks`.
 *
 * The second job is inline markup. A sentence with a link or a key name in it cannot be one
 * `t()` call, and splitting it into three would give a translator three fragments in an order
 * they cannot change. So the values may be React nodes: `<T id="Press {key} to pause"
 * values={{ key: <kbd>Esc</kbd> }} />` keeps the sentence whole for the translator and lets the
 * element sit wherever their grammar puts the placeholder.
 *
 * With no values it returns the string itself, so the DOM is identical to a bare literal —
 * `<h1><T id="Settings" /></h1>` renders `<h1>Settings</h1>`, which is what keeps the exported
 * English markup byte-identical to what it was before the string was converted.
 *
 * ## Where not to put one
 *
 * The root layout. Every element in `layout.tsx` is serialised into all 108 play-route payloads
 * a catalogue browse prefetches, so a `<T>` there costs its props 108 times over on the
 * `speculatedBytes` line — `size-budget.json` calls that multiplier the most expensive place in
 * the repository to spend a byte. The layout's own copy is translated by converting the
 * components it mounts, which are their own client boundaries, not by wrapping its literals.
 */
export function T({
  id,
  values,
}: {
  id: string;
  values?: Readonly<Record<string, ReactNode>> | undefined;
}): ReactNode {
  const catalogue = useMessages();
  const text = catalogue[id] ?? id;
  if (values === undefined) return text;
  // `split` with a capturing group alternates text and placeholder names: even indices are
  // text, odd are the name inside the braces. A name with no value renders as the placeholder
  // it was, for the reason `messages.ts` gives — a typo should be visible, not blank.
  return text
    .split(/\{(\w+)\}/)
    .map((part, index) => (
      <Fragment key={index}>{index % 2 === 0 ? part : (values[part] ?? `{${part}}`)}</Fragment>
    ));
}
