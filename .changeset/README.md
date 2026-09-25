# Changesets

This folder holds [changesets](https://github.com/changesets/changesets): a short note per
meaningful change describing which packages changed and how, which the release workflow turns
into version bumps and changelogs. See [`docs/versioning.md`](../docs/versioning.md) for the full
flow.

## Adding a changeset

```bash
pnpm changeset
```

Pick the packages you changed, a bump level (patch / minor / major), and write a one-line
summary. Commit the generated markdown file alongside your change.

## Notes for this repository

- **Every package is `private: true` and nothing is published to a registry.** `config.json` sets
  `privatePackages.version` and `privatePackages.tag` to `true` so private packages still get
  versions and tags; there is no publish step.
- A change that needs no version bump — docs, tests, workflows — needs no changeset.
- Merging to `main` opens a **"Version Packages"** pull request via
  `.github/workflows/release.yml`; merging that PR is what applies the bumps.
- `pnpm install` must be run once so the `@changesets/cli` in the root `devDependencies` is
  available before `pnpm changeset` works.
