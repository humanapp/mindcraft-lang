# Publishing Guide

This document describes how to publish `@mindcraft-lang/*` packages to npm.

## Package Dependency Order

Packages have internal `file:` dependencies that form a directed graph:

```
core            (no local deps)
bridge-client -> core
typescript   -> core
ui           -> core
docs         -> core, ui
```

The release script handles dependency ordering automatically -- see "Running a Release"
below.

## How Publishing Works

Each package has `release:patch`, `release:minor`, and `release:major` npm scripts that
invoke `scripts/release.js`. The script automatically walks the `file:` dependency tree,
releasing upstream packages first in topological order. For each package in the chain it:

1. Runs pre-release checks (build, lint) locally
2. Bumps the version in `package.json`
3. Commits `package.json` and `package-lock.json` with a message matching the git tag
4. Creates a git tag (e.g. `core-v0.2.0`)
5. Pushes the commit and tag to origin
6. Waits for the corresponding GitHub Actions publish workflow to succeed

Only after a dependency's CI workflow succeeds does the script proceed to the next package.
If any workflow fails, the script aborts immediately -- no downstream packages are bumped.

Private packages (`"private": true`) in the dependency chain are skipped.

Pushing a tag triggers the corresponding GitHub Actions workflow
(`.github/workflows/publish-*.yml`), which runs lint/build/tests and then calls
`npm publish`.

## Local `file:` Dependencies

In source, `package.json` files use `file:` paths for sibling packages:

```json
"@mindcraft-lang/core": "file:../core"
```

This ensures `npm install` on a fresh clone always creates the correct local symlinks,
regardless of whether a `package-lock.json` is present. See the note in
`packages/package.json` for the install order.

`file:` references are never committed to npm. Each publish workflow rewrites them to
proper version ranges (e.g. `^0.1.10`) in the CI runner before calling `npm publish`. The
source files on disk are never modified.

## Running a Release

From the package directory:

```sh
cd packages/bridge-client
npm run release:patch   # or release:minor / release:major
```

This will release `core`, then `bridge-client` -- each bumped by
`patch`, each waiting for CI before proceeding. For a leaf package like `core` with no
local deps, only `core` itself is released.

### Prerequisites

- **Clean working tree** -- the script aborts if there are uncommitted changes.
- **GitHub CLI (`gh`)** -- required to watch CI workflow runs. Install with
  `brew install gh` and authenticate with `gh auth login`.

### Failure Recovery

If a CI workflow fails mid-chain, the script stops. The packages that already succeeded
are published on npm with their new versions. Fix the issue and re-run. The already-
published packages will be detected as having no pending changes (their tags already exist)
-- but currently the script will bump them again. To avoid a no-op bump, release the
remaining packages individually.

## Versioning Policy

This repo follows semantic versioning:

- `patch` -- bug fixes, no API changes
- `minor` -- new backwards-compatible features
- `major` -- breaking API changes
