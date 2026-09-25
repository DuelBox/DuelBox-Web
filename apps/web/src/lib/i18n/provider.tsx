'use client';

import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSettings } from '@/lib/use-settings';
import { EMPTY_CATALOGUE, loadCatalogue } from './load';
import { applyLocale, DEFAULT_LOCALE, localeFromSearch, type LocaleCode } from './locales';
import type { Catalogue } from './messages';

/**
 * The active locale and its strings, held once for the whole tree (#219).
 *
 * ## One provider, in the root layout
 *
 * Mounted once, around everything `layout.tsx` renders, so that every client component reads
 * the same catalogue from one context and the chunk for a locale is fetched once rather than
 * once per control that wants a label. It is a `'use client'` component in the shell every
 * visitor downloads, which is the cost; it is written to be small because of it, and
 * `size-budget.json` (`_rederived_2026_09_12_i18n`) is where that cost was measured and
 * argued.
 *
 * ## Why the first render is empty
 *
 * The site is a static export: the server rendered English into the HTML, so the first client
 * render has to produce English too or React reports a hydration mismatch and throws the
 * markup away. So the state starts as the default locale with the empty catalogue — every
 * lookup falls through to the English id, byte for byte what the server wrote — and the stored
 * choice and its catalogue arrive in effects a frame later. That is the same shape `useSettings`
 * uses for the stored settings and `PlaySurface` for everything it reads from storage, and it
 * is why a visitor on the default locale never sees a flash: their catalogue *is* the empty one.
 *
 * ## Nothing is stamped until the stored settings have been read
 *
 * The first render's locale is the default, and `useSettings` replaces it with the stored one in
 * an effect. An effect here that applied the locale on every change *including the first* would
 * apply `en` once, before storage had been read, and for a player whose stored locale is
 * right-to-left that is a flip: the inline script in `layout.tsx` had stamped `ar-XB`/`rtl` before
 * paint, the provider's first effect put `en`/`ltr` back over it, and the next render restored the
 * choice. Measured on the built export, that is what shipped in the first draft of this file — a
 * `MutationObserver` on `<html>` saw `ar-XB/rtl → en/ltr → ar-XB/rtl` within 40 ms of `load` on
 * every route on both engines; WebKit held the wrong values for 10–44 ms and painted a frame the
 * wrong way round on two of the four routes probed (`/settings/`, `/games/`), on every load, for
 * exactly the visitor the before-paint stamp was added for. The end state was correct, which is
 * why the first version of the reload test did not see it. So the effect waits for the `loaded`
 * flag `useSettings` raises in the same effect that reads storage, and the reload test in
 * `e2e/i18n.spec.ts` now watches every change to `lang` and `dir` after `DOMContentLoaded` rather
 * than sampling the end.
 *
 * ## The switch-before-arrival race
 *
 * A player who picks `en-XA` and then `ar-XB` before the first chunk has landed must end up
 * with `ar-XB`'s strings, not whichever resolved last. The effect keeps a flag that the cleanup
 * React runs before re-running it clears, so a resolution that lands late is dropped on the
 * floor rather than written over the newer locale.
 *
 * ## `?lang=`, read here and nowhere else
 *
 * A `?lang=` on the address is a request for a locale — the only routing-aware form an
 * `output: 'export'` build can honour, since Next's locale routing is not available under it
 * and a `[locale]` segment would multiply every exported page. It is validated against the
 * registry, stored like any other choice, and never written back into the URL, so no route,
 * canonical or sitemap entry changes. An unknown code is ignored rather than applied: a link
 * from a build that shipped a language this one does not have must not silently drop the
 * player's own choice. Read in this one component rather than inside `useSettings`, because
 * that hook is mounted by every settings control on a page and each copy would otherwise
 * write the same value to storage on the same load.
 */

export interface LocaleState {
  readonly locale: LocaleCode;
  readonly catalogue: Catalogue;
}

/**
 * The default value doubles as the state of a component rendered with no provider above it —
 * the static render, or a test — which is English with nothing to look up.
 */
export const LocaleContext = createContext<LocaleState>({
  locale: DEFAULT_LOCALE,
  catalogue: EMPTY_CATALOGUE,
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [settings, update, loaded] = useSettings();
  const { locale } = settings;
  const [catalogue, setCatalogue] = useState<Catalogue>(EMPTY_CATALOGUE);

  useEffect(() => {
    const requested = localeFromSearch(location.search);
    if (requested !== null) update({ locale: requested });
  }, [update]);

  useEffect(() => {
    // Before storage has been read, `locale` is the default and not the player's: applying it
    // would undo the before-paint stamp. See the header.
    if (!loaded) return;
    applyLocale(locale);
    if (locale === DEFAULT_LOCALE) {
      setCatalogue(EMPTY_CATALOGUE);
      return;
    }
    let current = true;
    void loadCatalogue(locale).then((next) => {
      if (current) setCatalogue(next);
    });
    return () => {
      current = false;
    };
  }, [locale, loaded]);

  // One object per change, not per render: every `useMessages()` consumer re-renders when the
  // context value's identity changes, and a fresh literal on each render of the root layout
  // would re-render every consumer on every settings change that was not a locale change.
  const value = useMemo(() => ({ locale, catalogue }), [locale, catalogue]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
