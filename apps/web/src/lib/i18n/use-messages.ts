'use client';

import { useContext } from 'react';
import { LocaleContext } from './provider';
import type { LocaleCode } from './locales';
import type { Catalogue } from './messages';

/**
 * The active locale's strings inside a client component (#219).
 *
 * Read from the one context `LocaleProvider` fills, so a component asks for nothing but a
 * catalogue and hands it to `t()`. Outside a provider — the static render, a test — the
 * context's default value is English with nothing to look up, which is what every lookup falls
 * through to anyway.
 */
export function useMessages(): Catalogue {
  return useContext(LocaleContext).catalogue;
}

/** The active locale's code, for `plural()` and for anything that formats by locale. */
export function useLocale(): LocaleCode {
  return useContext(LocaleContext).locale;
}
