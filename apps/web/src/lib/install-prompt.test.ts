import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DISMISSAL_DAYS,
  INSTALL_KEY,
  readInstallMemory,
  rememberDismissed,
  rememberInstalled,
  shouldOfferInstall,
} from './install-prompt';

const DAY = 24 * 60 * 60 * 1000;

function install(storage: Storage | undefined): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    map,
    clear: () => {
      map.clear();
    },
    key: () => null,
    length: 0,
  } as unknown as Storage & { map: Map<string, string> };
}

const empty = { dismissedAt: null, installed: false };
const ready = { hasPrompt: true, matchFinished: true, memory: empty, now: 1_000_000 * DAY };

describe('when the offer is made', () => {
  it('never on a page where no match has finished, whatever the browser offers', () => {
    // The whole reason this module exists: the browser asks seconds into a first visit.
    expect(shouldOfferInstall({ ...ready, matchFinished: false })).toBe(false);
  });

  it('never without a prompt to show, because there is nothing to press', () => {
    expect(shouldOfferInstall({ ...ready, hasPrompt: false })).toBe(false);
  });

  it('after a finished match, with a prompt in hand and nothing remembered', () => {
    expect(shouldOfferInstall(ready)).toBe(true);
  });

  it('not again for thirty days after "Not now"', () => {
    const dismissedAt = ready.now - (DISMISSAL_DAYS - 1) * DAY;
    expect(shouldOfferInstall({ ...ready, memory: { dismissedAt, installed: false } })).toBe(false);
  });

  it('again once thirty days have passed', () => {
    const dismissedAt = ready.now - DISMISSAL_DAYS * DAY;
    expect(shouldOfferInstall({ ...ready, memory: { dismissedAt, installed: false } })).toBe(true);
  });

  it('reads a dismissal in the future as a dismissal, not as an expired one', () => {
    // A clock that went backwards must not turn "no" into "ask again".
    const dismissedAt = ready.now + DAY;
    expect(shouldOfferInstall({ ...ready, memory: { dismissedAt, installed: false } })).toBe(false);
  });

  it('never once installed', () => {
    expect(shouldOfferInstall({ ...ready, memory: { dismissedAt: null, installed: true } })).toBe(
      false,
    );
  });
});

describe('what is remembered', () => {
  let storage: Storage & { map: Map<string, string> };
  beforeEach(() => {
    storage = fakeStorage();
    install(storage);
  });
  afterEach(() => {
    install(undefined);
  });

  it('reads empty from nothing, from junk, and from the wrong version', () => {
    expect(readInstallMemory()).toEqual(empty);
    storage.setItem(INSTALL_KEY, 'not json');
    expect(readInstallMemory()).toEqual(empty);
    storage.setItem(INSTALL_KEY, JSON.stringify({ version: 2, dismissedAt: 5 }));
    expect(readInstallMemory()).toEqual(empty);
    storage.setItem(INSTALL_KEY, JSON.stringify({ version: 1, dismissedAt: 'soon' }));
    expect(readInstallMemory()).toEqual(empty);
  });

  it('keeps the dismissal and the install independently of each other', () => {
    rememberDismissed(42);
    expect(readInstallMemory()).toEqual({ dismissedAt: 42, installed: false });
    rememberInstalled();
    expect(readInstallMemory()).toEqual({ dismissedAt: 42, installed: true });
    expect(storage.map.get(INSTALL_KEY)).toContain('"version":1');
  });
});
