import { z } from 'zod';

/**
 * The manifest every game ships. The catalog, the per-game SEO page, the lobby and the
 * match host all read this without loading a byte of game code, so it is validated at
 * build time rather than trusted at runtime.
 */

export const ARCHETYPES = ['turn-board', 'turn-aim', 'rt-split', 'rt-arena', 'rt-race'] as const;

export const PLAY_MODES = ['friend', 'bot', 'solo'] as const;

export const PRESENTATIONS = ['shared-screen', 'single-seat'] as const;

/**
 * What a game may declare about which way round it wants the device.
 *
 * Wider than the engine's `Orientation` by the third value: a screen is portrait or
 * landscape and nothing else, but a *game* may honestly say "either" — 37 of the 108 do.
 * Keeping the two unions distinct is what stops `'any'` being passed anywhere a shape is
 * wanted, the same way `DeclaredZoneSplit` is kept apart from `ZoneSplit`.
 */
export const ORIENTATIONS = ['portrait', 'landscape', 'any'] as const;

export type DeclaredOrientation = (typeof ORIENTATIONS)[number];

/**
 * Which way round a device is actually being held. Two values, because a screen is one or
 * the other; `'any'` above is a thing a *game* may say, never a shape a screen can have.
 *
 * The concept belongs to the engine, which owns every conversion from pixels to anything
 * (rule 8) and exports the identical union from `packages/engine/src/viewport.ts` beside
 * `screenOrientation`, the one function that produces one. It is written out again here
 * rather than imported for a boring reason and not a design one: `packages/engine/src/index.ts`
 * does not re-export it and that file was outside this change's file set, so the import does
 * not resolve through the package entry point. **The fix is one line in the engine's index,
 * after which this alias should become `import type { Orientation } from '@duelbox/engine'`.**
 * The swap is safe to make blind — a union of two string literals is structurally identical
 * either way, so no caller changes.
 */
export type Orientation = 'portrait' | 'landscape';

/**
 * How far from square a box may be and still claim it serves both orientations.
 *
 * Turning the device costs a board some of its size: a tall box is width-bound in portrait
 * and height-bound in landscape, and on any screen more elongated than the box itself — which
 * is every phone — the two drawn sizes come out in exactly the ratio of the box's short side
 * to its long one. So this number is a statement in plain terms: **a game that says `'any'`
 * may not lose more than a fifth of its board's linear size when the device is turned.**
 * 1.25 is 1 / 0.8.
 *
 * The four non-square boards declaring `'any'` today — Blocks and Solitaire and Sudoku at
 * 900x1000, Paint Fight at 960x1080 — sit at 1.11 and 1.125, so all 37 pass with room. The
 * point of the bound is the cheap way out of this issue that it forecloses: a 600x1000 game
 * cannot become a game that "supports both orientations" by having its one word changed to
 * `'any'`. It has to declare a second box and mean it, or keep its preference and be honest
 * about it.
 */
const MAX_ANY_ASPECT = 1.25;

/** The dimensions any box has, which is all these three helpers need of one. */
interface Box {
  readonly width: number;
  readonly height: number;
}

/**
 * Which way round a box actually is, as a declaration rather than as a shape.
 *
 * `'any'` is returned for a square box, and it is the right word rather than a fudge: a
 * square box has no long axis, so it letterboxes to precisely the same drawn area whichever
 * way the device is held, and `'any'` is the only declaration it can honestly carry. That is
 * why the check below rejects `orientation: 'portrait'` on a 900x900 board — the word would
 * be describing a preference the geometry cannot express.
 */
function shapeOf(box: Box): DeclaredOrientation {
  if (box.width === box.height) return 'any';
  return box.width > box.height ? 'landscape' : 'portrait';
}

/** Long side over short side, so a 900x1000 box and a 1000x900 box both read 1.11. */
function anyAspect(box: Box): number {
  return box.width > box.height ? box.width / box.height : box.height / box.width;
}

/** For error messages: a manifest author reads "600x1000 (taller than wide)", not a ratio. */
function describeShape(box: Box): string {
  const shape = shapeOf(box);
  const words =
    shape === 'any' ? 'square' : shape === 'portrait' ? 'taller than wide' : 'wider than tall';
  return `${String(box.width)}x${String(box.height)} (${words})`;
}

/** How the two seats divide a shared screen. */
export const ZONE_SPLITS = ['horizontal', 'vertical', 'shared-board'] as const;

/**
 * The device classes the shell is designed and verified at, smallest to largest.
 *
 * The same five widths `docs/responsive.md` names — `compact` from 320px, `phone` from
 * 480px, `tablet` from 640px, `laptop` from 1024px, `wide` from 1440px. A game lists the
 * classes it is designed for so the catalogue can grey out a game a device is too small to
 * play well, before a player picks it and hits a board squeezed to a sliver (issue #1864).
 * The field is optional: a game that omits it is taken to support every class, which is
 * what every game built before this field shipped actually does.
 */
export const DEVICE_CLASSES = ['compact', 'phone', 'tablet', 'laptop', 'wide'] as const;

const slug = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/, 'must be lowercase kebab-case');

/**
 * Simulation runs in these units, never in pixels, so a phone and a laptop step the
 * identical match. The renderer scales this box to the device and letterboxes the rest.
 */
const logicalSize = z.object({
  width: z.number().int().positive().max(10_000),
  height: z.number().int().positive().max(10_000),
});

/** The kinds of per-game option the generic options panel can render (#1751). */
export const GAME_OPTION_TYPES = ['select', 'toggle', 'range'] as const;

export type GameOptionType = (typeof GAME_OPTION_TYPES)[number];

/**
 * An option's id, and the key its stored value lives under.
 *
 * Kebab-case like a slug so it reads the same in a manifest, a storage key and a URL, and so
 * two options cannot differ only by case and collide once stored.
 */
const optionId = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/, 'option id must be lowercase kebab-case');

const optionLabel = z.string().min(1).max(60);

const optionChoice = z.object({
  value: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
});

const selectOption = z
  .object({
    type: z.literal('select'),
    id: optionId,
    label: optionLabel,
    /** At least two, or it is not a choice; capped so a panel does not become a form. */
    choices: z.array(optionChoice).min(2).max(12),
    default: z.string().min(1).max(40),
  })
  .strict();

const toggleOption = z
  .object({
    type: z.literal('toggle'),
    id: optionId,
    label: optionLabel,
    default: z.boolean(),
  })
  .strict();

const rangeOption = z
  .object({
    type: z.literal('range'),
    id: optionId,
    label: optionLabel,
    min: z.number(),
    max: z.number(),
    /** Step between allowed values. One by default, which is what a round count wants. */
    step: z.number().positive().default(1),
    default: z.number(),
  })
  .strict();

/**
 * One typed option a game declares. The panel renders it from this and nothing else, so a
 * game adds an option without writing any UI (#1751).
 *
 * The union is discriminated on `type` so a bad shape is reported against the branch it meant
 * to be, and the coherence checks — a select whose default is one of its choices, a range
 * whose default sits inside its bounds — run after, because a discriminated union cannot carry
 * a refinement on its members.
 */
export const gameOptionSchema = z
  .discriminatedUnion('type', [selectOption, toggleOption, rangeOption])
  .superRefine((option, ctx) => {
    if (option.type === 'select' && !option.choices.some((c) => c.value === option.default)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['default'],
        message: 'a select option default must be one of its choices',
      });
    }
    if (option.type === 'range') {
      if (option.min >= option.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['min'],
          message: 'a range option needs min < max',
        });
      }
      if (option.default < option.min || option.default > option.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['default'],
          message: 'a range option default must lie within [min, max]',
        });
      }
    }
  });

export type GameOption = z.infer<typeof gameOptionSchema>;

export const gameManifestSchema = z
  .object({
    id: slug,
    name: z.string().min(1).max(60),
    category: z.string().min(1).max(40),
    archetype: z.enum(ARCHETYPES),

    /** Which modes the lobby may offer. Declaring one a game cannot run is a build error. */
    modes: z.array(z.enum(PLAY_MODES)).min(1),
    presentations: z.array(z.enum(PRESENTATIONS)).min(1),

    logical: logicalSize,

    /**
     * The orientation this game's `logical` box is designed for.
     *
     * The field has shipped in every manifest since the first one and, until #1886, **nothing
     * read it**: 108 games declared one of three words and not one line of the product
     * branched on any of them. That is why giving it a meaning breaks nothing — there was no
     * behaviour to preserve — and it is also why the meaning is written down here rather than
     * left to be inferred from a name:
     *
     * - `'portrait'` / `'landscape'` — the box has a long axis and this says which way it
     *   runs. The game is entirely playable turned the other way; it letterboxes, like
     *   everything else in this product, and the shell may *offer* to be turned without ever
     *   standing in the way (see {@link rotateHintFor}). 67 games declare portrait, 4
     *   landscape.
     * - `'any'` — one box serves both, so there is nothing to suggest and the player is never
     *   nagged about how they are holding the device. This is the default and what an unset
     *   manifest gets; today it is the 33 square boards and 4 near-square ones.
     *
     * `superRefine` below holds the word against the shape of the box in both directions, so
     * a manifest cannot go on saying something its own geometry contradicts. A game that is
     * genuinely laid out both ways declares `alternateLogical` below as well, and keeps its
     * preference here.
     */
    orientation: z.enum(ORIENTATIONS).default('any'),

    /**
     * A second logical box, adopted when a match starts with the device turned the way
     * `orientation` does not name — the "re-layout rather than letterbox" half of #1886.
     *
     * Rule 8 is what makes this the only lever there is. A game never sees a pixel, so it
     * cannot lay itself out from the screen; the single thing that can differ between a phone
     * held upright and the same phone held sideways is the **logical box the game is handed**,
     * and every position the game computes follows from that. So a second box is not a
     * rendering hint. It is a second design, and declaring one is a promise that the game
     * reads correctly in both.
     *
     * Three consequences come with it, none of them optional. A game that cannot accept all
     * three should keep its preference and letterbox, which is a perfectly good answer:
     *
     * 1. **The box is chosen once, when the match starts, and frozen for its life.** Turning
     *    the device mid-match re-letterboxes and changes nothing else. Re-choosing the box on
     *    a rotation would move every position in the simulation under two people mid-rally,
     *    which is precisely the lost match state #1886 forbids — and it is the obvious
     *    implementation of "re-layout", which is why it is ruled out here in writing and in
     *    `packages/engine/src/viewport.test.ts`, which drives a simulation both ways and shows
     *    the difference.
     * 2. **Both devices in a remote match adopt the same box**, however each player happens to
     *    be holding their own phone, because rule 9 says neither may see more of the world than
     *    the other and `LockstepSession` refuses a pair whose configuration disagrees. One of
     *    the two therefore letterboxes. The box is part of the match configuration, not a
     *    per-device presentation choice.
     * 3. **Everything the rules measure against the box changes with it** — a track's length, a
     *    goal mouth, how far a shot can carry. That is the actual work, and it is why this is
     *    opt-in and why no game in the catalogue declares it yet.
     *
     * Optional rather than defaulted, for the reason `handoff` sets out below: a defaulted
     * field is *required* in the inferred output type, which would force all 108 manifests —
     * including the ones already compiled into their packages' `.d.ts` — to be rebuilt to add
     * it. Absent means "one box, both ways up", which is what every game does today.
     */
    alternateLogical: logicalSize.optional(),

    zoneSplit: z.enum(ZONE_SPLITS),

    /**
     * The smallest device viewport, in CSS pixels, at which this game is playable.
     *
     * Distinct from `logical`: `logical` is the fixed simulation box, in logical units,
     * identical on every device (rule 8); `minViewport` is a claim about the *physical*
     * screen a game needs, so the lobby can refuse a match a phone is too small to show
     * fairly rather than letterbox it to an unplayable sliver. Optional — omitted, a game
     * makes no claim and the shell falls back to the 320x480 floor `docs/responsive.md`
     * names. Not part of the simulation and never read by `update()`.
     */
    minViewport: z
      .object({
        width: z.number().int().positive().max(10_000),
        height: z.number().int().positive().max(10_000),
      })
      .optional(),

    /**
     * The device classes this game is designed and verified at. Optional; omitted means
     * every class. See {@link DEVICE_CLASSES}.
     */
    deviceClasses: z.array(z.enum(DEVICE_CLASSES)).min(1).optional(),

    /** Used by the catalog filters and by the tournament to pace a run. */
    roundSeconds: z.number().int().positive().max(1800),

    /**
     * What each seat's keys and pointer do, in the game's own words.
     *
     * Two people sharing a laptop have one keyboard and no touchscreen, so the keyboard
     * is not a fallback — it is the whole desktop experience. Every game declares its
     * scheme here so the shell can show both players their controls without a game
     * drawing its own legend, and so a game shipping without an answer fails the build.
     */
    controls: z.object({
      /** e.g. "Move with W A S D, drop with Space". Written for a player, not a spec. */
      keyboard: z.string().min(4).max(120),
      /** e.g. "Drag to aim, release to fire". Empty when the archetype has no pointer idiom. */
      pointer: z.string().max(120).default(''),
    }),

    tags: z.array(z.string().min(1).max(24)).max(12).default([]),
    /** Games that cannot be made fair across input families declare it here. */
    sameInputClassOnly: z.boolean().default(false),

    /**
     * Whether this game hides information between turns, and so needs the pass-and-play
     * hand-off blackout between them (#134).
     *
     * Opt-in and off by default: a game that does not set it renders no hand-off screen and
     * is untouched, so a shared board like Tic Tac Toe never blacks out and only a game that
     * actually keeps a secret — a hand of cards, a hidden placement — asks for the cover.
     *
     * `.optional()` rather than `.default(false)` on purpose: a defaulted field is *required*
     * in the inferred output type, which would force every existing manifest — including the
     * hundred already compiled into their packages' `.d.ts` — to be rebuilt to add it. Optional
     * keeps the field off the manifests that never mention it, so read it as `handoff === true`.
     */
    handoff: z.boolean().optional(),

    /**
     * The game's own options — board size, round length, a variant toggle — as typed schema
     * entries the generic panel renders with no bespoke UI (#1751).
     *
     * Optional, so a game with nothing to configure declares nothing and every existing
     * manifest still validates and still type-checks without being rebuilt (see `handoff`).
     * Read it as `options ?? []`. Ids must be unique within a game, or two options would write
     * to and read from the same stored key.
     */
    options: z.array(gameOptionSchema).max(12).optional(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (manifest.modes.includes('friend') && !manifest.presentations.includes('shared-screen')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['presentations'],
        message: 'a game offering "friend" must support the shared-screen presentation',
      });
    }
    if (manifest.modes.includes('solo') && !manifest.presentations.includes('single-seat')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['presentations'],
        message: 'a game offering "solo" must support the single-seat presentation',
      });
    }
    if (new Set(manifest.modes).size !== manifest.modes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['modes'],
        message: 'modes must not repeat',
      });
    }
    /*
     * The declared orientation, held against the shape of the box it claims to describe.
     *
     * A word nothing checks is a word that drifts, and this one had further to drift than
     * most: it was read by nothing at all until #1886, so a manifest could have said
     * "landscape" over a 600x1000 box for a year and no test, no build step and no screen
     * would have disagreed. All 108 manifests in the catalogue pass these three as written —
     * they were checked one by one against their built `dist/manifest.js` rather than assumed
     * — so the checks cost nothing today. What they buy is the next copy-pasted manifest, and
     * the shortcut described at {@link MAX_ANY_ASPECT}.
     */
    const shape = shapeOf(manifest.logical);
    if (manifest.orientation !== 'any' && shape !== manifest.orientation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['orientation'],
        message: `declares "${manifest.orientation}" but its logical box is ${describeShape(manifest.logical)}`,
      });
    }
    if (manifest.orientation === 'any' && anyAspect(manifest.logical) > MAX_ANY_ASPECT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['orientation'],
        message:
          `"any" says one box serves both orientations, but this box is ${describeShape(manifest.logical)} ` +
          `and would lose more than a fifth of its size turned the other way — declare the orientation it is ` +
          `designed for, and add "alternateLogical" if it is genuinely laid out both ways`,
      });
    }
    if (manifest.alternateLogical !== undefined) {
      if (manifest.orientation === 'any') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['alternateLogical'],
          message:
            'a game whose one box already serves both orientations has no second orientation to lay out for',
        });
      } else if (shapeOf(manifest.alternateLogical) === manifest.orientation) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['alternateLogical'],
          message: `must be the other way round from "logical", and this one is ${describeShape(manifest.alternateLogical)} too`,
        });
      } else if (shapeOf(manifest.alternateLogical) === 'any') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['alternateLogical'],
          message:
            'a square second box is not a second layout — a square box serves both orientations on its own',
        });
      }
    }

    const optionIds = (manifest.options ?? []).map((option) => option.id);
    if (new Set(optionIds).size !== optionIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'option ids must be unique within a game',
      });
    }
  });

export type GameManifest = z.infer<typeof gameManifestSchema>;
export type GameArchetype = (typeof ARCHETYPES)[number];
export type PlayMode = (typeof PLAY_MODES)[number];
export type Presentation = (typeof PRESENTATIONS)[number];
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

/**
 * The presentations a game supports.
 *
 * The declaration lives in the required `presentations` field — this surfaces it under the
 * name the crossplay work refers to it by, so a reader asking "what does this game support?"
 * has one answer rather than reaching into the manifest shape. A game offering the remote
 * (single-seat) option only when it declares it is what stops a player picking a match the
 * game cannot present (issue #1864).
 */
export function supportedPresentations(manifest: GameManifest): readonly Presentation[] {
  return manifest.presentations;
}

/**
 * Whether a device of the given CSS-pixel viewport is big enough for this game.
 *
 * A game with no `minViewport` makes no claim and is playable everywhere the shell reaches
 * (down to the 320x480 floor). A game that declares one is refused on a screen below it in
 * either dimension, before the match rather than after the board has been squeezed to a
 * sliver. This is the catalogue-filter and lobby-gate half of issue #1864.
 */
export function supportsViewport(
  manifest: GameManifest,
  viewport: { readonly width: number; readonly height: number },
): boolean {
  const min = manifest.minViewport;
  if (min === undefined) return true;
  return viewport.width >= min.width && viewport.height >= min.height;
}

/**
 * Whether this game is designed for the given device class.
 *
 * A game with no `deviceClasses` supports every class, which is what every game predating the
 * field does. One that lists classes supports exactly those.
 */
export function supportsDeviceClass(manifest: GameManifest, deviceClass: DeviceClass): boolean {
  return manifest.deviceClasses === undefined || manifest.deviceClasses.includes(deviceClass);
}

/**
 * The orientation this game would rather be played in, or null when it has no preference.
 *
 * The whole of "preferred" from #1886, and it is deliberately one line over one field: a
 * second declarable field for the preference would be a second thing to keep in step with
 * the box, and the manifest already has one field that has to agree with the geometry.
 */
export function preferredOrientation(manifest: GameManifest): Orientation | null {
  return manifest.orientation === 'any' ? null : manifest.orientation;
}

/**
 * Whether this game has a layout *designed* for the given orientation.
 *
 * **This is not a gate, and it must never become one.** Every game in the catalogue is
 * playable in every orientation — the box letterboxes, the pointer maths is in logical units,
 * and the shell's `short` height class already moves the scoreboards out of a sideways
 * phone's way (docs/responsive.md). Turning the device may make a board smaller; it never
 * makes a game unreachable, and a player who wants to play Road Dodge sideways is entitled
 * to. `supportsViewport` and `supportsDeviceClass` are gates and are named for it; this one
 * is named for what it is, so that it does not end up filtering a catalogue by accident.
 *
 * The answer is derived rather than declared, which is the point: "supported" is
 * `orientation` plus whether a second box exists, so a manifest cannot claim to support an
 * orientation it has no layout for. The three cases are `'any'` (one box, both ways up), the
 * declared orientation itself, and — only when `alternateLogical` is present — the other one.
 */
export function isDesignedForOrientation(
  manifest: GameManifest,
  orientation: Orientation,
): boolean {
  if (manifest.orientation === 'any') return true;
  if (manifest.orientation === orientation) return true;
  return manifest.alternateLogical !== undefined;
}

/**
 * The logical box a match adopts for a device held this way round.
 *
 * The one function that answers "re-layout rather than letterbox", and the only place the
 * second box is ever reached for. Read it **once, when a match starts**, and hold the answer
 * for the life of that match: calling it again on a rotation would hand the game a different
 * box mid-play and move every position in the simulation, which is the state loss #1886 says
 * must never happen. `alternateLogical`'s own comment sets out why, and
 * `packages/engine/src/viewport.test.ts` shows the two traces diverging.
 *
 * A game with no second box gets its own box for both orientations, which is what all 108
 * manifests do today.
 */
export function logicalForOrientation(
  manifest: GameManifest,
  orientation: Orientation,
): GameManifest['logical'] {
  const alternate = manifest.alternateLogical;
  if (alternate === undefined) return manifest.logical;
  if (manifest.orientation === 'any' || manifest.orientation === orientation) {
    return manifest.logical;
  }
  return alternate;
}

/**
 * The orientation to *suggest* turning to, or null for "say nothing" — the whole input to
 * the rotate prompt, and null for every game in the catalogue as it stands.
 *
 * Null in three of the four cases, which is the shape a hint should have: a game with no
 * preference never asks, a game already held its preferred way never asks, and a game with a
 * second layout never asks because it has one for where the device already is. Only a game
 * with a preference and no layout for the other way has anything to say, and even then what
 * it has is a suggestion.
 *
 * **The sentence that used to end this paragraph — "and null for every game in the catalogue
 * as it stands" — was wrong the day it was written.** No game declares `alternateLogical`, and
 * 71 declare an orientation, so this is non-null for 71 of 108 whenever the device is the
 * other way up. `manifest.test.ts` now counts both numbers off the catalogue rather than
 * stating them, because a count written into a comment is a count nothing recomputes.
 *
 * What the shell does with a non-null answer is constrained, and the constraint is the
 * acceptance criterion rather than a style note: the prompt **must not block**. No overlay
 * over the board, no focus trap, no modal, nothing that stops the match — a pair who are
 * happy playing sideways must be able to ignore it forever and keep playing. Rule 7 applies
 * to it as to everything else: it reads as words ("Turn the phone upright for a bigger
 * board"), never as a colour or an icon alone. `docs/orientation.md` sets out the placement.
 */
export function rotateHintFor(
  manifest: GameManifest,
  orientation: Orientation,
): Orientation | null {
  if (isDesignedForOrientation(manifest, orientation)) return null;
  return preferredOrientation(manifest);
}

/** Throws a readable error naming the game, so a bad manifest fails the build loudly. */
export function parseGameManifest(input: unknown): GameManifest {
  const result = gameManifestSchema.safeParse(input);
  if (!result.success) {
    const id =
      typeof input === 'object' && input !== null && 'id' in input ? String(input.id) : '<unknown>';
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid game manifest for "${id}" — ${detail}`);
  }
  return result.data;
}
