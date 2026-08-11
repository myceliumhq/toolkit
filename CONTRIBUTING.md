# Contributing

## Dev setup

```bash
pnpm install
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm run test
```

## Commit messages

This repo releases via [semantic-release](https://semantic-release.gitbook.io/semantic-release/):
every commit message on `main` must follow [Conventional Commits](https://www.conventionalcommits.org/).
There is no manual version bump -- don't edit `version` in any package's `package.json`.

| Prefix | Effect |
| --- | --- |
| `fix: ...` | patch release |
| `feat: ...` | minor release |
| `feat!: ...` or a `BREAKING CHANGE:` footer | major release |
| `chore:`, `docs:`, `refactor:`, `test:`, `ci:` | no release |

Never spell out GitHub's own skip-CI marker (the bracketed "skip" + "ci" pair) literally in a
commit message unless you actually want that push to skip every workflow -- GitHub matches it as
a plain substring anywhere in the message, including inside a sentence explaining what it does.
Live-hit: a commit message here that merely *described* `@semantic-release/git`'s own skip-CI
commit template ended up skip-CI'd itself, since the marker text appeared verbatim in the
explanation.

## Release process

This repo ships 4 independently-versioned packages from one git history. Merging to `main` runs
[`.github/workflows/release.yml`](./.github/workflows/release.yml), a matrix job that runs
`semantic-release` once per package directory. Each package's own `.releaserc.json` extends
[`semantic-release-monorepo`](https://github.com/semantic-release/monorepo), which scopes commit
analysis and the release tag to that package's own directory -- otherwise plain `semantic-release`
would misattribute every commit in the repo to every package.

Publishing uses npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) -- no
token secret. Each of `@myceliumhq/toolkit`, `@myceliumhq/embed`, `@myceliumhq/index`,
`@myceliumhq/mcp` needs its own Trusted Publisher configured on npmjs.com (Settings → Trusted
Publishing) pointing at this repo and `.github/workflows/release.yml` -- npm validates against
this workflow file, so a renamed/moved file needs updating there too for all 4 packages.

Each package's `.releaserc.json` includes `@semantic-release/git`, committing the version bump
straight back to `package.json` on `main` -- the matrix's `max-parallel: 1` exists specifically so
those 4 packages' commits don't race pushing to the same branch (semantic-release aborts a release
rather than risk publishing from a stale checkout: "the local branch main is behind the remote
one"). That abort is silent -- the job still reports success. If a package's release needs
retriggering, push a new commit; don't use "re-run this workflow" from the Actions UI/`gh run
rerun` -- it replays the *original* triggering commit, which by then is behind whatever the other
packages' release commits already pushed to `main`, hitting the exact same silent-abort.
