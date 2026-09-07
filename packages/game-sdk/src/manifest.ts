import { z } from 'zod';

/**
 * The manifest every game ships. The catalog, the per-game SEO page, the lobby and the
 * match host all read this without loading a byte of game code, so it is validated at
 * build time rather than trusted at runtime.
 */

export const ARCHETYPES = ['turn-board', 'turn-aim', 'rt-split', 'rt-arena', 'rt-race'] as const;

export const PLAY_MODES = ['friend', 'bot', 'solo'] as const;

export const PRESENTATIONS = ['shared-screen', 'single-seat'] as const;

export const ORIENTATIONS = ['portrait', 'landscape', 'any'] as const;

/** How the two seats divide a shared screen. */
export const ZONE_SPLITS = ['horizontal', 'vertical', 'shared-board'] as const;

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
    orientation: z.enum(ORIENTATIONS).default('any'),
    zoneSplit: z.enum(ZONE_SPLITS),

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
