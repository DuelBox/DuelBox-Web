# Visual regression on the shell screens (#227)

`e2e/visual.spec.ts` photographs five shell screens and holds them against the PNGs committed
in `e2e/__screenshots__`. It is the only guard in this repository that can see a stylesheet
edit move a card six pixels, drop a border, or swap a colour token for one four shades off.
Every other spec asks a question with a name; this one asks whether the page still looks like
it did when somebody last agreed that it should.

The five, and why only five, are argued out in the docstring at the top of that file. The
short version: a baseline that churns is a baseline nobody reads, so the catalogue grid, the
game landing pages and the eighteen category hubs are deliberately not here.

## The baselines are Linux, and they are committed

`playwright.config.ts` writes them to
`e2e/__screenshots__/{arg}{-projectName}{-platform}{ext}`, which on CI is
`<name>-chromium-linux.png`. The five in the repository came from run
[34686082168](https://github.com/DuelBox/DuelBox-Web/actions/runs/34686082168) on `main` at
4751b32.

A screenshot is a fact about a platform: macOS rasterises text through CoreText and Linux
through Chromium's FreeType, so the same build of the same page is a different picture on
each, by more than any threshold worth setting. So the spec **skips itself off Linux** rather
than fail on a Mac for a reason no developer can fix, and `.gitignore` keeps `-darwin` and
`-win32` baselines out of the repository. On CI it never skips — a baseline missing from the
repository is `A snapshot doesn't exist at …` and a red job, because `updateSnapshots` is
`'none'` in the config and nothing in `ci.yml` takes a picture before the suite runs.

Locally, `npx playwright test e2e/visual.spec.ts --project=chromium -u changed` writes your
own `-darwin` set. They are for watching your own change; CI will not look at them.

## Accepting an intentional change

The suite went red and the reason is that you meant to move something. The failing job has
already run the visual spec a second time with `-u changed` and attached both the new
baselines and a picture of what moved. The shard is in the name of the job that went red:

```bash
gh run download <run-id> -n visual-baselines-<shard> -D e2e/__screenshots__
gh run download <run-id> -n visual-diffs-<shard> -D /tmp/visual-diffs
```

**Look at the diffs before you commit the baselines.** `/tmp/visual-diffs` holds a
`-diff.png` per screen — the page ghosted with the changed pixels lit up — and a `-actual.png`
of what this build drew. What you are checking is that every lit pixel is a pixel your change
was supposed to move. A diff that also lights up a control you never touched is the guard
doing its job, and the answer is to fix the change, not to accept the picture.

Then `git add e2e/__screenshots__` and commit.

### The rule

**A baseline is updated in the same commit as the change that moved it.** Not a follow-up, not
a "fix baselines" commit at the end of a branch. A baseline commit on its own carries no
evidence that anybody looked: the reviewer sees a binary file change with no cause next to it,
and the only honest thing they can do is take your word for it. In the same commit as the CSS,
the diff answers its own question.

For the same reason, do not accept a baseline you have not looked at. Five churning baselines
are how a reviewer learns to approve a diff without opening it, which costs more than this
guard is worth.

## When the pictures are the problem

If the baselines are stale for a reason that is nobody's change — a Playwright upgrade that
revised text rendering, a font file replaced, the runner image moving — regenerate all five in
one commit, say which upgrade did it in the message, and do it on its own branch so the diff
is the whole story.
