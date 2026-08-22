# wendoo-cli

Command-line tools for publishing and versioning Wendoo projects.

A Wendoo project is a directory with a `wendoo.json` manifest (plus the
files it lists). This CLI publishes such a project to GitHub as a versioned,
installable release, bumps its version, and turns a `.wendoo` export from
the web editor into a project directory you can publish.

## Install and run

Requires Node.js 18 or newer.

Run without installing:

```
npx wendoo-cli <command> [arguments]
```

Or install once and call it directly:

```
npm install -g wendoo-cli
wendoo <command> [arguments]
```

Both give you the same `wendoo` command. Examples below use `wendoo`;
substitute `npx wendoo-cli` if you did not install it.

## Commands at a glance

| Command | What it does |
|---|---|
| [`wendoo publish`](#wendoo-publish) | Publish a version of a project to its GitHub repository. |
| [`wendoo version`](#wendoo-version) | Increment a project's version in its `wendoo.json`. |
| [`wendoo unpack`](#wendoo-unpack) | Turn a `.wendoo` export into a publishable project directory. |

Running `wendoo` with no command, or an unknown command, prints usage and
exits non-zero.

`wendoo --version` (or `-v`) prints this CLI's own version and exits. It is
separate from the [`version`](#wendoo-version) command below, which changes
a project's version.

## Concepts (read once)

- `wendoo.json` is the project manifest. It carries the project's `version`,
  its `files` list, its `identity`, and everything else the project comprises.
- A project's identity is its `<owner>/<repo>` GitHub coordinate, recorded in
  the manifest's `identity` field. You do not hand-write it: `publish` stamps it
  from the repository you publish to, and `unpack --coordinate` sets it once.
- A published version is the project's content at the git tag `v<version>` on
  its GitHub repository. The manifest version and the tag always match.

---

## `wendoo publish`

Publish a version of the project to its GitHub repository: commit the project's
tree, tag it `v<version>`, and push.

```
wendoo publish [patch|minor|major] [--dir <path>] [--remote <url>] [--allow-unstable-refs]
```

### Arguments

| Argument | Meaning |
|---|---|
| `patch` \| `minor` \| `major` | Optional. Increment that part of the version before publishing. Omit it only for the very first publish to a repository that has no tags yet, which publishes the manifest's current version as-is. |
| `--dir <path>` | Project directory. Default: the current directory. |
| `--remote <url>` | The git remote to publish to. Usually unnecessary (see below). |
| `--allow-unstable-refs` | Permit dependencies that are unstable for people who install this project: a branch reference, or a pinned version the source does not yet serve. Without this flag, publishing stops and asks you to confirm. |

### How the publish target is chosen

If you do not pass `--remote`, where the project publishes depends on your
checkout:

- The project directory is the root of its own git checkout: it publishes to
  that checkout's `origin`.
- The project lives in a subdirectory of a larger checkout (for example a
  monorepo), or its checkout has no `origin`: it publishes to the GitHub remote
  derived from the recorded identity, `https://github.com/<owner>/<repo>.git`.
- A first publish, before any identity is recorded, targets `origin`.

Pass `--remote <url>` to override this.

### What it does

- Bumps the manifest version (if you named a component) and stamps the
  manifest's `identity` with the coordinate of the publish remote. It prints a
  warning if that changes a previously recorded identity (for example when you
  publish a clone to your own repository -- a fork).
- Commits the project's tree (its `wendoo.json` plus the files the manifest
  lists), tags it `v<version>`, and pushes the branch and tag.
- Writes the published version and identity back into the project directory's
  `wendoo.json` when the tree is published to a derived or explicit remote.

Requires the git working tree to be clean, and Git credentials that can push to
the target repository. Published repositories are public.

### Examples

First publish, run from inside the project after creating its empty GitHub repo:

```
wendoo publish
```

Cut a routine release (bump the patch version and publish):

```
wendoo publish patch
```

Publish a library kept in a monorepo subdirectory (the remote is derived from
its recorded identity):

```
wendoo publish minor --dir libs/my-widget
```

Publish to an explicit repository:

```
wendoo publish patch --remote https://github.com/acme/my-widget.git
```

Publish even though a dependency points at a moving branch:

```
wendoo publish patch --allow-unstable-refs
```

---

## `wendoo version`

Increment the project's version in its `wendoo.json`, without publishing.

```
wendoo version <patch|minor|major> [--dir <path>]
```

### Arguments

| Argument | Meaning |
|---|---|
| `patch` \| `minor` \| `major` | Required. Which part of the version to increment. |
| `--dir <path>` | Project directory. Default: the current directory. |

### What it does

Reads the project's `wendoo.json`, increments the version by the named
component, writes it back, and prints the new version (for example
`version 1.4.0`).

Use this when you package a target for distribution: bump the version first so
the built bundle bakes in the new version, then publish the packaged target
verbatim (no bump at publish time).

### Examples

```
wendoo version patch
wendoo version minor --dir path/to/project
```

Fails with `VERSION_MANIFEST_MISSING` if the directory has no `wendoo.json`,
or `VERSION_MANIFEST_INVALID` if the manifest cannot be parsed.

---

## `wendoo unpack`

Turn a `.wendoo` export (downloaded from the web editor) into a project
directory on disk that you can then publish.

```
wendoo unpack <file.wendoo> [dir] [--coordinate <owner/repo>] [--force]
```

### Arguments

| Argument | Meaning |
|---|---|
| `<file.wendoo>` | Required. The exported document to unpack. |
| `dir` | Target directory. Default: the document's base name, in the current directory. |
| `--coordinate <owner/repo>` | Record this as the project's published identity in the manifest's `identity` field. |
| `--force` | Allow unpacking into a directory that is not empty. |

### What it does

Writes the export's embedded manifest as `wendoo.json` and every file in the
export to disk. If the manifest declares no `files` list, one is generated
naming every unpacked file -- including any scratch files that were in the
exported workspace, so review and prune `wendoo.json` before publishing.
Prints how many files were written.

After unpacking, that directory is the canonical project: publish from it, and
treat re-exporting from the app as an occasional release step, not a live sync.

### Examples

Unpack into a directory named after the file (`./my-project`):

```
wendoo unpack my-project.wendoo
```

Unpack into a chosen directory and record the project's identity:

```
wendoo unpack my-project.wendoo my-widget --coordinate acme/my-widget
```

Unpack into the current, non-empty directory:

```
wendoo unpack export.wendoo . --force
```

---

## Exit codes and output (for scripting and automation)

- Every command returns exit code `0` on success and `1` on failure.
- Human-readable results go to stdout; errors go to stderr.
- Failures carry a stable, uppercase error code in the stderr message (for
  example `VERSION_MANIFEST_MISSING`, `PUBLISH_UNCOMMITTED_CHANGES`,
  `PUBLISH_UNSTABLE_DEPENDENCIES_UNCONFIRMED`). Match on the code, not the
  surrounding prose.

## Using this CLI as a tool (for LLMs and agents)

- Invoke exactly one command per call: `wendoo <command> [arguments]`.
  Available commands are `publish`, `version`, and `unpack`. `wendoo
  --version` reports the tool's own version.
- All input is positional arguments and flags; the CLI does not read piped
  stdin. It is safe to run non-interactively.
- Decide success from the exit code (`0` ok, `1` failed), not from output text.
  On failure, read stderr and match the uppercase error code.
- `publish` performs network and git operations (commit, tag, push) against a
  real GitHub repository and requires push credentials. Do not run it to
  "test"; it has durable, external side effects. `version` and `unpack` only
  touch local files.
- `--dir` defaults to the current working directory for `publish` and
  `version`. Pass `--dir <path>` explicitly when the working directory is not
  the project.
- `publish` will stop and require confirmation if a dependency is unstable for
  consumers; pass `--allow-unstable-refs` only when that is intended.
