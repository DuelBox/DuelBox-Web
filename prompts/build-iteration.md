Work one issue to completion. Do not start a second.

SELECT
  gh issue list --state open --label "milestone-ready" --json number,title,labels
  Pick the lowest-numbered issue that is not `blocked` and whose
  dependencies are closed. If nothing qualifies, report that and stop.

PLAN
  Comment on the issue with your implementation plan before writing code.
  If the acceptance criteria are ambiguous, ask in the comment and stop.

BRANCH
  git checkout -b issue/<number>-<slug>

BUILD
  Implement it. Tests alongside the code, not after.
  Read CLAUDE.md again if you are about to touch engine, input, or assets.

VERIFY  — all must pass before you open a PR
  pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm size
  Tick every acceptance checkbox in the issue body, or explain which
  one you could not meet and why.

PR
  gh pr create --fill --body "Closes #<number>" with a summary of what
  changed and how you verified it.

REPORT
  One paragraph: what you built, what you verified, anything you
  discovered that should become a new issue. File those issues now.

Then stop. Do not pick up the next issue.
