# Versioning the game packages with Changesets

The repository is a pnpm workspace of many private packages — the engine, the SDK, and one per
game — and until #11 nothing recorded *what changed in which package* or gave any of them a
version that moved. Changesets is that record: a short markdown note per meaningful change, which
a release step turns into version bumps and changelogs.

**Every package here is `private: true` and nothing is published to a registry.** So Changesets
is used for **versioning, changelogs and tagging only** — the publish step is deliberately not
run. The value is the changelog and the version history, not an npm release.

## The everyday flow

1. **Make your change** on a branch as normal.
2. **Add a changeset** describing it:

   ```bash
   pnpm changeset
   ```

   It asks which packages changed, at what bump level (patch / minor / major), and for a one-line
   summary. It writes a markdown file into `.changeset/`. Commit that file with your change — the
   changeset is part of the PR, reviewed like any other file.

3. **Merge to `main`.** The release workflow (below) collects the pending changesets and opens a
   **"Version Packages" pull request** that applies the bumps and writes the changelogs. Merging
   *that* PR is what actually versions the packages.

You write changesets; you do not edit versions or changelogs by hand. If a change needs no
version bump — a doc, a test, a workflow — it needs no changeset, and the release workflow simply
finds nothing to do.

### What bump level to pick

- **patch** — a fix that does not change how anything is used: a bug in a game's rules, a tuning
  change, an internal refactor.
- **minor** — new capability that is backwards compatible: a new game, a new SDK helper, a new
  manifest field with a default.
- **major** — a breaking change to a shared contract: the `Game` interface, the manifest schema in
  a way that invalidates existing manifests, an engine API every game calls. These are the changes
  `.github/CODEOWNERS` already routes to the owner, and a major bump is the version-history version
  of that same "this touches everyone" signal.

## Configuration

`.changeset/config.json` holds the settings. The ones that matter here:

- `"baseBranch": "main"` — the branch releases target.
- `"privatePackages": { "version": true, "tag": true }` — **this is the load-bearing line.** By
  default Changesets ignores private packages entirely; this opts them into versioning and tagging
  so our private game packages get versions and a git tag, without ever being published.
- `"access": "restricted"` and no publish step — belt and braces against an accidental registry
  push.
- `"changelog": "@changesets/cli/changelog"` — the built-in changelog generator, so no extra
  dependency.
- `"updateInternalDependencies": "patch"` — when the engine bumps, the games that depend on it get
  a patch bump so their changelog records that they were rebuilt against it.

## The release workflow

`.github/workflows/release.yml` runs on push to `main`. It:

1. Checks for pending changesets. If there are none, it does nothing — the common case for a merge
   that carried no changeset.
2. If there are changesets, runs `pnpm changeset version` (which consumes the changeset files,
   bumps versions and writes changelogs) on a branch, and opens or updates a **"Version Packages"**
   pull request with the result — using the GitHub CLI already on the runner rather than a
   third-party action, so no unpinned action enters the supply chain (secure-coding rule 9). The
   version bump lands only when a human merges that PR.
3. **Does not publish.** The packages are private; the workflow versions and (on the release PR's
   merge) tags, and stops there. If publishing is ever wanted, it is a deliberate, separately
   reviewed addition, not a default.

The release workflow only runs on `main`, so it does not run in a normal PR's CI and cannot
interfere with the verify gate.

## Enabling it

`@changesets/cli` is declared in the root `package.json` `devDependencies`. Run **`pnpm install`**
once to fetch it — this is the one step that must happen before `pnpm changeset` works, because the
CLI is not yet in the committed lockfile. After that, `pnpm changeset` is available to everyone.

## Why this and not something heavier

The alternatives are manual version bumps (which nobody keeps consistent across 100+ packages) or
a monorepo release tool that assumes publishing. Changesets fits because it treats "what changed"
as a small file a contributor writes at the moment they know the answer, and because it is content
to version private packages that never publish — which is exactly this repository's shape.
