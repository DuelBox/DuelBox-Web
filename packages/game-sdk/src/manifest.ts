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
