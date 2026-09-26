import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * These probes supply unsaved source through `lintText`, like an editor. The parser's
 * CI=true heuristic otherwise treats the first call as an immutable disk-only run and
 * checks the clean file on disk, then treats a repeated filename as an autofix pass.
 * Select its editor mode for these instances only. Config lookup, projects and rules
 * still come from the repository; no process environment or source file is changed.
 */
function eslintAt(cwd: string): ESLint {
  return new ESLint({
    cwd,
    overrideConfig: {
      languageOptions: { parserOptions: { disallowAutomaticSingleRunInference: true } },
    },
  });
}

/**
 * Run the installed ESLint with its normal config discovery, not an imported config.
 * ESLint 10 starts that search beside each linted file. The empty app config that once
 * suppressed Next's duplicate lint pass therefore hid every app rule from `pnpm lint`.
 * Existing source paths let the real type-aware parser check these deliberate defects
 * without writing a broken fixture into the worktree.
 */
describe('the repository lint actually reaches the app', () => {
  it.each(['.', 'apps/web'])(
    'enforces app rules when invoked from %s',
    async (cwd) => {
      const eslint = eslintAt(join(root, cwd));
      const results = await eslint.lintText(
        `import { useEffect } from 'react';
export function LintCoverage({ enabled }: { enabled: boolean }) {
  if (enabled) useEffect(() => {}, []);
  useEffect(() => { String(enabled); }, []);
  Promise.resolve('unhandled');
  return <p>Untranslated coverage control</p>;
}`,
        { filePath: join(root, 'apps/web/src/app/page.tsx') },
      );
      const errors = results.flatMap((result) => result.messages);
      for (const ruleId of [
        '@typescript-eslint/no-floating-promises',
        'react-hooks/rules-of-hooks',
        'react-hooks/exhaustive-deps',
        'duelbox/no-untranslated-text',
      ]) {
        expect(errors, `normal config discovery did not enforce ${ruleId}`).toContainEqual(
          expect.objectContaining({ ruleId, severity: 2 }),
        );
      }
    },
    // The real type-aware parser first builds the whole lint project (32s locally).
    // Allow for CI's slower cold start; later calls share that program.
    180_000,
  );

  it('still enforces the gameplay rules outside the app', async () => {
    const results = await eslintAt(root).lintText('Math.random();', {
      filePath: join(root, 'packages/engine/src/vec2.ts'),
    });
    expect(results.flatMap((result) => result.messages)).toContainEqual(
      expect.objectContaining({ ruleId: 'no-restricted-properties', severity: 2 }),
    );
  }, 180_000);
});
