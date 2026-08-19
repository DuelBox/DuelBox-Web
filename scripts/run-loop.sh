#!/usr/bin/env bash
# Drive Claude Code through the backlog, one issue per iteration.
#
#   ./scripts/run-loop.sh owner/duelbox 20
#
# Halts on the first iteration that fails verification, so a bad assumption
# stops at one issue instead of propagating through twenty.

set -euo pipefail

REPO="${1:?usage: run-loop.sh <owner/repo> [iterations]}"
ITERATIONS="${2:-10}"
PROMPT="prompts/build-iteration.md"
LOG_DIR=".loop-logs"

[[ -f "$PROMPT" ]] || { echo "Missing $PROMPT — see CLAUDE_CODE_LOOP.md"; exit 1; }
mkdir -p "$LOG_DIR"

open_count() {
  gh issue list --repo "$REPO" --state open --limit 1000 --json number \
    | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))'
}

echo "Repo: $REPO"
echo "Open issues: $(open_count)"
echo "Iterations: $ITERATIONS"
echo

for i in $(seq 1 "$ITERATIONS"); do
  stamp=$(date +%Y%m%d-%H%M%S)
  log="$LOG_DIR/iter-$i-$stamp.log"

  echo "──────────────────────────────────────────"
  echo "Iteration $i/$ITERATIONS  →  $log"
  echo "──────────────────────────────────────────"

  git checkout main --quiet
  git pull --quiet

  if ! claude -p "$(cat "$PROMPT")" \
        --allowedTools "Bash,Read,Write,Edit,Glob,Grep" \
        2>&1 | tee "$log"; then
    echo
    echo "Iteration $i failed. Log: $log"
    echo "Fix the cause before continuing — do not just rerun."
    exit 1
  fi

  if grep -qiE "nothing qualifies|no issues? (are )?ready|stopping" "$log"; then
    echo
    echo "No workable issues remain. Run the grooming loop."
    break
  fi

  echo
  echo "Iteration $i done. Open issues: $(open_count)"
  sleep 5
done

echo
echo "Loop finished. Review open PRs:"
gh pr list --repo "$REPO" --state open
