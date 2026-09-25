import { INSTALL_KEY, MATCH_FINISHED } from './install-prompt-key';
import { readVersioned, writeVersioned } from './local-store';

/**
 * When to offer "add to your home screen", and when to stay quiet (#195).
 *
 * The browser fires `beforeinstallprompt` on a page it judges installable, usually seconds
 * into a first visit — which is the worst possible moment to ask. A visitor who has played
 * nothing has no reason to want the site on their home screen, and a prompt dismissed then
 * is a prompt Chrome will not offer again for months. So the event is captured and *held*,
 * and the question is asked once, after a match has been played to its end, which is the
 * first moment the answer could reasonably be yes.
 *
 * Two facts drive the decision and both are stored here. "Has a match finished in this
 * document" is a runtime fact carried by the {@link MATCH_FINISHED} event that `PlaySurface`
 * raises after it records a result. "Did they say not now, and when" is persisted, so a
 * refusal is respected for {@link DISMISSAL_DAYS} across reloads and days rather than being
 * re-asked at the next result screen — the issue's "at least thirty days".
 *
 * `installed` is persisted as well, because once the prompt's promise resolves `accepted`
 * there is nothing further to offer, and `beforeinstallprompt` will not fire for an installed
 * app anyway; recording it keeps the decision pure and testable rather than reliant on the
 * browser never firing again.
 */
export { INSTALL_KEY, MATCH_FINISHED };

const VERSION = 1;

/** How long a "Not now" is honoured, in days. The issue asks for at least thirty. */
export const DISMISSAL_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface InstallMemory {
  /** Epoch milliseconds of the last "Not now", or null if never dismissed. */
  readonly dismissedAt: number | null;
  /** Whether the site was installed from this prompt. */
  readonly installed: boolean;
}

const EMPTY: InstallMemory = { dismissedAt: null, installed: false };

/** What this device remembers about the offer. Absent, malformed or blocked storage reads empty. */
export function readInstallMemory(): InstallMemory {
  const stored = readVersioned(INSTALL_KEY, VERSION);
  if (stored === null) return EMPTY;
  const at = stored['dismissedAt'];
  const installed = stored['installed'];
  return {
    dismissedAt: typeof at === 'number' && Number.isFinite(at) ? at : null,
    installed: installed === true,
  };
}

export function rememberDismissed(now: number): void {
  const current = readInstallMemory();
  writeVersioned(INSTALL_KEY, VERSION, { dismissedAt: now, installed: current.installed });
}

export function rememberInstalled(): void {
  const current = readInstallMemory();
  writeVersioned(INSTALL_KEY, VERSION, { dismissedAt: current.dismissedAt, installed: true });
}

/**
 * Whether to show the offer now.
 *
 * Every input is explicit so the rule can be read in one place and held in a test: the
 * browser has handed over a prompt, a match has finished in this document, the site is not
 * already installed, and no "Not now" is younger than {@link DISMISSAL_DAYS}. A clock that
 * has gone backwards — a dismissal in the future — is treated as a dismissal today rather
 * than as an expired one, because the safe reading of a nonsense timestamp is "they said no".
 */
export function shouldOfferInstall(input: {
  readonly hasPrompt: boolean;
  readonly matchFinished: boolean;
  readonly memory: InstallMemory;
  readonly now: number;
}): boolean {
  const { hasPrompt, matchFinished, memory, now } = input;
  if (!hasPrompt || !matchFinished || memory.installed) return false;
  if (memory.dismissedAt === null) return true;
  const age = now - memory.dismissedAt;
  if (age < 0) return false;
  return age >= DISMISSAL_DAYS * DAY_MS;
}

/** Raise the match-finished signal. Safe to call where there is no window. */
export function announceMatchFinished(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(MATCH_FINISHED));
}
