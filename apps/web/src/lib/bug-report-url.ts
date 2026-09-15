import type { Presentation } from '@duelbox/engine';
import type { MatchState } from '@duelbox/game-sdk';
import type { BotDifficulty, PlayMode } from '@/lib/match-setup';

/**
 * The address of a bug report with the context already filled in (#233).
 *
 * A report without the device, the browser, the game and the match state usually cannot be
 * acted on, and a reporter who has to go and find all four rarely does. GitHub's issue forms
 * prefill an `input` or `textarea` from a query parameter named after the field's id, so the
 * link the pause menu and the result screen offer carries what `bug.yml` asks for: `game`,
 * `device`, `size`, and the opening lines of `steps`. The dropdowns (`seat`, `input`) are
 * left to the reporter — their prefill format is not documented, and which seat saw the bug
 * is the one thing the device cannot know on a shared screen.
 *
 * Pure, and the whole of the impurity is {@link readBugReportEnvironment}: the builder takes
 * everything as an argument so it can be tested to the byte, and the reader is the one
 * function that touches `navigator` and the window. The user-agent string travels verbatim
 * and is never parsed — behaviour here branches on nothing in it, which is the rule
 * `docs/privacy-policy.md` records; it is data bound for an issue a person chooses to open.
 *
 * What is deliberately not in the URL: player names. `app/privacy/page.tsx` promises they
 * never leave the device, and a link the player can inspect before pressing is still a
 * place they would leave it. The prose is not translated, on purpose: it is the body of a
 * GitHub issue that a maintainer triages in English, not copy a visitor reads.
 */

export const BUG_REPORT_FORM = 'https://github.com/DuelBox/DuelBox-Web/issues/new';
export const BUG_REPORT_TEMPLATE = 'bug.yml';
/**
 * The one unbounded input is the user-agent, and it is clipped here. The slug comes from the
 * game registry and the rest is short, so the address never approaches GitHub's own length
 * limit (an over-long one is answered 414, not silently truncated) and nothing else is capped.
 */
const DEVICE_MAX = 256;

export interface BugReportMatch {
  /** The game's display name, for the steps. The slug is the form's own field. */
  readonly game: string;
  readonly mode: PlayMode | undefined;
  /** Reported only when the mode is `bot`; the difficulty means nothing otherwise. */
  readonly difficulty: BotDifficulty | undefined;
  readonly presentation: Presentation;
  readonly rounds: number;
  readonly state: Pick<MatchState, 'phase' | 'round' | 'roundWins' | 'tally' | 'seed'>;
}

export interface BugReportContext {
  /** The game's slug, or `shell` for the site itself, as `bug.yml` asks. */
  readonly slug: string;
  readonly device?: string | undefined;
  readonly viewport?: { readonly width: number; readonly height: number } | undefined;
  readonly orientation?: 'portrait' | 'landscape' | undefined;
  readonly match?: BugReportMatch | undefined;
}

/** The first lines of "Steps to reproduce", in the shape `bug.yml`'s own placeholder uses. */
function stepsFor(slug: string, match: BugReportMatch): string {
  const who =
    match.mode === 'bot'
      ? `against the bot on ${match.difficulty ?? 'an unknown tier'}`
      : match.mode === 'solo'
        ? 'solo'
        : 'two players on this device';
  const { state } = match;
  return [
    `1. Open /play/${slug}/`,
    `2. Start ${match.game}: ${who}, best of ${String(match.rounds)}, ${match.presentation}`,
    `3. It was round ${String(state.round)} of ${String(match.rounds)} ` +
      `(rounds ${String(state.roundWins.p1)}-${String(state.roundWins.p2)}, ` +
      `score ${String(state.tally.p1)}-${String(state.tally.p2)}, ${state.phase}; ` +
      `seed ${String(state.seed)}) when:`,
    '4. ',
  ].join('\n');
}

/** The address, with every field the caller could give and nothing it could not. */
export function bugReportUrl(context: BugReportContext): string {
  const params = new URLSearchParams();
  params.set('template', BUG_REPORT_TEMPLATE);
  params.set('game', context.slug);
  if (context.device) params.set('device', context.device.slice(0, DEVICE_MAX));
  if (context.viewport) {
    const size = `${String(context.viewport.width)}x${String(context.viewport.height)}`;
    params.set('size', context.orientation ? `${size}, ${context.orientation}` : size);
  }
  if (context.match) params.set('steps', stepsFor(context.slug, context.match));
  return `${BUG_REPORT_FORM}?${params.toString()}`;
}

/**
 * The shape of the global this module reads, with everything admitted to be optional: on
 * the build machine there is no window, and the DOM types say otherwise about all four.
 */
interface ReportingGlobal {
  readonly navigator?: { readonly userAgent?: string };
  readonly innerWidth?: number;
  readonly innerHeight?: number;
  readonly matchMedia?: (query: string) => { readonly matches: boolean };
}

/** What the device can say about itself, read when the link is built and never stored. */
export function readBugReportEnvironment(): Pick<
  BugReportContext,
  'device' | 'viewport' | 'orientation'
> {
  const global: ReportingGlobal = globalThis;
  const device = global.navigator?.userAgent;
  const width = global.innerWidth;
  const height = global.innerHeight;
  const viewport =
    typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0
      ? { width, height }
      : undefined;
  let orientation: 'portrait' | 'landscape' | undefined;
  if (viewport) {
    // The media query is the same answer `RotatePrompt` reads; the fallback is for an
    // engine with no `matchMedia`, which is exactly the kind of device that files bugs.
    let portrait = viewport.height >= viewport.width;
    try {
      const query = global.matchMedia?.('(orientation: portrait)');
      if (query) portrait = query.matches;
    } catch {
      // Keep the geometric answer.
    }
    orientation = portrait ? 'portrait' : 'landscape';
  }
  return {
    device: device !== undefined && device !== '' ? device : undefined,
    viewport,
    orientation,
  };
}
