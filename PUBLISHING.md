# Publishing Guide

This document describes how to publish `@mindcraft-lang/*` packages to npm.

## Package Dependency Order

Packages must be published in dependency order. Publishing a downstream package before its
upstream dependencies exist on npm will cause consumers to get a version range that cannot
be resolved.

```
1. @mindcraft-lang/core        (no local deps)
2. @mindcraft-lang/typescript  (depends on: core)
3. @mindcraft-lang/ui          (depends on: core)
4. @mindcraft-lang/docs        (depends on: core, ui)
```

You only need to publish a package if it has changed. Publishing `core` does not require
re-publishing `ui` or `docs` unless you also want to update their pinned version ranges.

## How Publishing Works

Each package has `release:patch`, `release:minor`, and `release:major` npm scripts that
invoke `scripts/release.js`. This script:

1. Bumps the version in `package.json`
2. Commits `package.json` and `package-lock.json` with a message matching the git tag
3. Creates an annotated git tag (e.g. `core-v0.2.0`)
4. Pushes the commit and tag to origin

Pushing the tag triggers the corresponding GitHub Actions workflow
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
cd packages/core
npm run release:patch   # or release:minor / release:major
```

The script will abort if there are uncommitted changes in the working tree. Commit or
stash everything first.

After the script completes, the tag is pushed and the GitHub Actions workflow starts
automatically. Monitor it at:
https://github.com/humanapp/mindcraft-lang/actions

## Versioning Policy

This repo follows semantic versioning:

- `patch` -- bug fixes, no API changes
- `minor` -- new backwards-compatible features
- `major` -- breaking API changes
