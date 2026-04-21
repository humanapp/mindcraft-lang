# Project Import/Export -- Draft Spec

**Status:** Draft
**Date:** 2026-04-19

## Overview

Projects can be exported to a portable JSON file and imported on any machine.
The format is split into a **common layer** (files, brains) that any Mindcraft
host can interpret, and an **app-specific layer** that hosts use to persist
their own state (actors, population counts, brain wiring, etc.). Apps own
their section of the file and can evolve it independently.

## Design Principles

- **Portable.** No machine-specific or session-specific data (IDs, timestamps,
  cache artifacts).
- **Self-contained.** A single `.mindcraft` file (JSON) holds everything needed
  to reconstruct the project.
- **Layered.** Common data (source files, brain definitions) lives in well-known
  top-level fields. App-specific data lives in the `app` object, whose schema
  is owned by the host that exported the file.
- **Forward-compatible.** `host.version` is the single source of truth for
  schema compatibility. An importer knows how to read files from its own
  version or any older version of the same host. No separate format or
  section version numbers are needed.
- **New identity on import.** Exported files carry no project ID. Importing
  always creates a fresh project with a new ID and fresh timestamps.
- **Resilient.** Import never throws. All errors and warnings are collected as
  diagnostics and returned to the caller. Partial success (e.g. some brains
  fail to deserialize) is preferred over total failure.
- **Host-scoped.** An app only imports files that were exported by the same
  host. The `host.name` in the file must match the importing app's package
  name, and `host.version` must not be newer than the importing app's current
  version. Cross-host portability is not a goal.
- **Storage-only.** Import writes exclusively to the project store. It must
  not modify active game state, UI state, global localStorage, or any other
  mutable state outside the store. A caller can import any number of projects
  without affecting the currently active project. Activation (loading brains,
  applying population counts, initializing the compiler) happens only when
  the caller explicitly opens the imported project via `switchProject`.
- **Atomic.** Import is all-or-nothing. If any validation step fails, nothing
  is written to the store. All parsing, validation, and app layer callback
  execution completes before the first store write. There is no partial
  project to clean up on failure.
- **Greenfield.** This is pre-release code with no shipped customers. No
  migration, backward-compatibility, or data-loss mitigation work is needed.
  Breaking changes to stored data formats are acceptable.

## File Format

A `.mindcraft` file is UTF-8 encoded JSON text. Source file contents are
represented as JSON strings. Only text files are supported; binary assets
are excluded.

## Export Schema

```jsonc
{
  // -- Host that generated the file --
  "host": {
    // matches `name` from apps' package.json
    "name": "@mindcraft-lang/sim",
    "version": "0.4.12"
  },

  // -- Project metadata --
  "name": "My Ecosystem",
  "description": "A predator-prey simulation",

  // -- Common layer: workspace files --
  // mindcraft.json is excluded (regenerated on import).
  // Read-only / compiler-controlled files are excluded.
  "files": [
    { "path": "src/main.ts", "content": "export function main() { ... }" },
    { "path": "src/lib/helpers.ts", "content": "..." }
  ],

  // -- Common layer: brain definitions --
  // Keyed by an opaque string identifier. Keys have no assumed format or
  // semantic meaning -- they are stable references that app-specific data
  // uses to link to brain definitions (e.g. an actor's "brain" field is a
  // key into this map).
  // Each value is the output of BrainDefinition.toJson() -- not a custom
  // schema. On import, BrainDef.fromJson() deserializes them back.
  "brains": {
    "carnivore": {
      "version": 1,
      "name": "carnivore",
      "catalog": [],
      "pages": []
    },
    "herbivore": {
      "version": 1,
      "name": "herbivore",
      "catalog": [],
      "pages": []
    }
  },

  // -- App-specific layer --
  // Owned by the host identified in `host.name`. The schema is host-defined.
  // Compatibility is governed by `host.version`.
  "app": {
    "actors": [
      {
        "archetype": "carnivore",
        "brain": "carnivore",       // key into top-level "brains"
        "desiredCount": 5
      },
      {
        "archetype": "herbivore",
        "brain": "herbivore",
        "desiredCount": 12
      },
      {
        "archetype": "plant",
        "brain": null,
        "desiredCount": 30
      }
    ]
  }
}
```

## Common Layer

### Field Reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `host` | `Host` | yes | Identity of the app that exported the file. Determines schema compatibility. |
| `name` | `string` | yes | Project display name. Must be non-empty after trimming. |
| `description` | `string` | yes | May be empty string. |
| `files` | `FileEntry[]` | yes | May be empty array. |
| `brains` | `Record<string, BrainJson>` | yes | May be empty object. Each value is the serialized form produced by `BrainDefinition.toJson()`. Keys are opaque identifiers with no assumed format or semantic meaning. The app layer references brains by these keys. |
| `app` | `object` | no | App-specific data. Schema owned by the exporting host. |

### Host

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | `string` | yes | Package name of the exporting app (e.g. `"@mindcraft-lang/sim"`). |
| `version` | `string` | yes | Package version at export time (e.g. `"0.4.12"`). |

### FileEntry

| Field | Type | Required | Notes |
|---|---|---|---|
| `path` | `string` | yes | Relative path using `/` separators. No leading `/`. |
| `content` | `string` | yes | File contents as a JSON string. Only text files are supported. |

Directories are inferred from file paths and are not listed explicitly.

## App-Specific Layer

The `app` object holds app-specific data whose schema is owned by the host
identified in `host.name`. Since import already verifies that `host.name`
matches the importing app and that `host.version` is not newer, the `app`
object is always in a format the importing host understands. When importing,
a host:

1. Reads `app`.
2. If missing, the import fails. A host that provides an app layer callback
   is declaring that `app` is required for a valid project.
3. Deserializes using its own logic, consulting `host.version` to handle any
   schema differences between versions. Brain references
   (`"brain": "carnivore"`) are resolved against the top-level `brains` map.

The host is responsible for backward-compatible deserialization of `app` across
its own version history.

### Sim App (`app`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `actors` | `SimActor[]` | yes | Actor configurations. |

### SimActor

| Field | Type | Required | Notes |
|---|---|---|---|
| `archetype` | `string` | yes | Archetype key (e.g. `"carnivore"`). Unknown archetypes are skipped on import. |
| `brain` | `string \| null` | yes | Key into top-level `brains`. `null` for actors with no brain. |
| `desiredCount` | `number` | yes | Target population. Clamped to valid range on import. |

## What Is Excluded

| Data | Reason |
|---|---|
| Project `id` | New ID assigned on import. |
| `createdAt` / `updatedAt` | Reset to import time. |
| `mindcraft.json` | Regenerated from metadata + host info. |
| `etag` values | Session-specific conflict tokens. |
| Read-only / compiler-controlled files | Generated artifacts (e.g. `__examples__/`, compiler output). |
| User tile metadata cache | Rebuilt from compilation on first run. |
| UI preferences | Machine/session-specific (time scale, debug, bridge). |
| Bridge binding tokens | Session-specific. |

## Export Behavior

### Common layer (in `app-host` or `bridge-app`)

1. Collect the workspace snapshot from the active project.
2. Filter out:
   - `mindcraft.json` (regenerated on import).
   - Paths starting with `__examples__/` (injected examples).
   - Read-only entries (compiler-controlled files).
   - Directory entries (inferred from file paths).
   - Binary files (not supported).
3. Collect brain definitions from app data key `"brains"`.
4. Assemble the JSON envelope with `host`, `name`, `description`, `files`,
   and `brains`.

### App layer (in each host app)

5. The host app populates `app` with its own versioned data.
   For `@mindcraft-lang/sim`: iterate archetypes, emit
   `{ archetype, brain, desiredCount }`.
6. Serialize to a formatted JSON string (2-space indent).
7. Offer the file for download as `{project-name}.mindcraft`.

## Import Behavior

Import returns a result object to the caller. It never throws.

```ts
interface ImportResult {
  success: boolean;
  projectId: string | undefined;
  diagnostics: ImportDiagnostic[];
}

interface ImportDiagnostic {
  severity: "error" | "warning";
  message: string;
}
```

If `success` is `false`, no project was created. If `success` is `true`, the
project was created and `projectId` is set; `diagnostics` may still contain
warnings (e.g. skipped brains).

### Store-first import strategy

Import uses the same project-load code path as opening any existing project.
Rather than creating a live project, writing files into its workspace, and
then flushing back to storage, import follows a two-phase approach:

1. **Parse and validate.** Read the file, parse JSON, validate the envelope
   (host, version, required fields), validate file paths, build the workspace
   snapshot in memory, serialize brains, run the app layer callback. All of
   this happens before any store write. If any step fails, return an error
   diagnostic with no side effects -- nothing is written to the store.

2. **Write to store.** Once all validation passes, call
   `ProjectManager.createFromSnapshot()` to write the project manifest,
   description, workspace snapshot, and app data to the store. This is the
   only step that mutates persistent state. The project is not opened.

This design has several benefits:

- **Single load code path.** There is no separate "import load" vs "normal
  load" path. The project is fully written to storage before it is ever
  opened, and opening uses the same `openInternal` logic as every other
  project.
- **`mindcraft.json` regeneration is handled by the normal path.** The
  project-open path already regenerates `mindcraft.json` from the manifest
  and host info (via `syncManifestToMindcraftJson` in
  `AppEnvironmentHost`). There is no need for the import function to do
  this separately.
- **No live workspace manipulation during import.** The import function
  never touches a live workspace. It builds a `WorkspaceSnapshot` (a
  `Map<string, WorkspaceEntry>`) from the file entries and passes it to
  the store. Directory entries are not needed in the snapshot -- the
  workspace's `import` action infers them from file paths.
- **App layer callback is pure.** The callback must not perform side
  effects (no writes to localStorage, no UI mutations, no game state
  changes). It validates the `app` payload and returns diagnostics plus
  optional `appData` entries to be written to the project store. Any
  app-specific activation (e.g. applying population counts to the running
  simulation) happens later, when the project is opened via
  `switchProject`.

### Common layer

1. Check file size via `File.size` (raw byte count) before reading the file
   content. If it exceeds the size limit (default 5 MB), return an error
   diagnostic without parsing. The limit is app-configurable so hosts that
   need larger files can relax it.
2. Parse the file as JSON. If parsing fails, return an error diagnostic.
3. Validate `host.name` matches the importing app's package name. If missing
   or mismatched, return an error diagnostic ("This project was created by
   {host.name} and cannot be imported here.").
4. Validate `host.version` is not newer than the importing app's current
   version (semver compare). If it is newer, return an error diagnostic
   ("This project was exported by a newer version of {host.name}
   ({host.version}). Update the app before importing.").
5. Validate required fields (`name`, `description`, `files`, `brains`).
   If malformed, return an error diagnostic.
6. If `name` is empty after trimming, substitute `DEFAULT_PROJECT_NAME`.
7. Validate file entries and build a `WorkspaceSnapshot`. For each file
   entry, validate `path` (string, no `..`, no leading `/`, `/` separator)
   and `content` (string). Invalid entries produce a warning diagnostic and
   are skipped. Valid entries become `WorkspaceFileEntry` values
   (`kind: "file"`, `isReadonly: false`, `etag: crypto.randomUUID()`).
8. Validate and serialize the `brains` object. If not a valid object,
   record a warning and substitute `"{}"`.
9. Run the app layer callback (if provided). If `doc.app` is undefined,
   return an error diagnostic -- a host that provides a callback is
   declaring that `app` is required. Otherwise, call the callback with
   the `app` field. The callback must be pure -- no side effects. It
   validates the app-specific payload and returns diagnostics plus
   optional `appData` entries (key/value pairs to be written to the
   project store). If the callback returns any error-severity diagnostic,
   abort and return the errors. This happens before any project is created
   so errors bail out cleanly.
10. Create the project in the store via `ProjectManager.createFromSnapshot()`,
    passing: name, description, workspace snapshot, and app data entries.
    App data is assembled as `{ ...callbackAppData, brains: serializedBrains }`
    -- brains always wins if the callback also returns a `brains` key.
    This writes everything to the store without opening the project.
11. Return `{ success: true, projectId, diagnostics }`. The caller is
    responsible for calling `switchProject(projectId)` to open the project
    through the normal load path.

### App layer

The app layer callback runs during the validation phase (step 9). It must
not perform side effects -- no writes to localStorage, no UI mutations, no
game state changes. Its contract:

- **Input:** the `app` object from the export file, plus `host.version`.
- **Output:** `{ diagnostics, appData? }` where `appData` is an optional
  `Record<string, string>` of key/value pairs to store as project app data.
- If `app` is present, validate and transform it into store-compatible
  entries. For the sim, this means converting the `actors` array into a
  serialized JSON string stored under a project app data key (e.g.
  `"actors"`).
- If `app` is missing but a callback is provided, the common layer returns
  an error: "No app-specific data found in the export file." A host that
  provides a callback is declaring that `app` is required for a valid
  project.
- If the callback returns any error-severity diagnostic, the common layer
  aborts import and returns the errors. No project is created.
- Any app-specific activation (applying population counts, updating
  simulation state) happens when the project is opened via `switchProject`,
  not during import.

After `importProject` returns success, the caller may open the imported
project by calling `switchProject(projectId)`. This is not required --
the imported project is fully persisted and will appear in the project
picker. If the caller does open it, the normal load path initializes the
compiler, loads brains from app data, regenerates `mindcraft.json`, fires
project-loaded listeners, and gives the host a chance to read its app
data and apply it to the running state.

## Validation Rules

- File size (raw bytes via `File.size`) must not exceed the size limit
  (default 5 MB, app-configurable). Checked before reading file content.
- `host.name` must match the importing app's package name.
- `host.version` must not be newer than the importing app's current version
  (semver compare).
- `name` must be a string.
- `description` must be a string.
- `files` must be an array. Each entry must have a string `path` and string
  `content`.
- File paths must not contain `..`, must not start with `/`, and must use
  `/` as the separator.
- `brains` must be an object. Values are not deeply validated at import time;
  `BrainDef.fromJson()` handles per-brain validation during deserialization.
  Brains that fail deserialization are skipped with a warning.
- `app` is optional. If present, must be an object. Validated by the host,
  not the common layer.
- Duplicate file paths: last entry wins (no error).

## UI Placement

Import and Export are placed on the **top-level hamburger menu** (the main
application menu), not nested inside the project picker or project header.

## Resolved Decisions

1. **Size limit:** 5 MB default (raw file bytes). The limit is
   app-configurable so hosts that need larger files can raise it.

2. **Name conflicts:** Project names are not unique. Importing a project with
   the same name as an existing project simply creates a second project with
   that name.

3. **Partial import:** Import continues on brain deserialization failures.
   Failed brains are skipped and recorded as warning diagnostics. The import
   function returns a result object with all collected diagnostics. Import
   never throws -- all errors are captured and returned.

4. **UI placement:** Import and Export live on the top-level hamburger menu.

5. **Cross-host import:** Apps refuse to import files from other hosts.
   `host.name` must match the importing app's package name, and
   `host.version` must not be newer than the importing app's current version.
   If either check fails, import returns an error diagnostic and does not
   create a project.
