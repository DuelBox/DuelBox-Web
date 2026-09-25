# ADR 000N — Title, stated as the decision rather than the topic

**Status:** proposed | accepted | superseded by ADR 000M
**Date:** YYYY-MM-DD

## Context

What was true when the decision was made: the constraint, the measurement, or the failure
that forced a choice. Cite the files that show it — `path/to/file.ts` — rather than
describing them from memory, so a reader can check the claim against the tree.

## Decision

**One sentence in bold saying what was decided.**

Then what it means in practice, what was considered instead and why it lost, and which
script, test or lint rule enforces it. A decision nothing enforces is a preference; say so
if that is what it is.

## Consequences

What follows, good and bad, each on its own line. Include the cost as plainly as the
benefit: the thing this makes harder, the alternative it rules out, and the condition under
which it should be revisited.

---

An ADR records a decision that has already been made. It is not a proposal to argue over
and it is not living documentation: once accepted it is never edited, except to change its
status line to `superseded by ADR 000M` when a later record replaces it. If the facts have
changed, write the next number rather than rewriting this one — the point of the file is
that a reader in a year can see what was known, and decided, at the time.

Number files `NNNN-short-slug.md`, add a line to `README.md`, and match the voice of the
existing records: measured facts, plain sentences, no marketing.
