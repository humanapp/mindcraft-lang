---
applyTo: "packages/app-host/**"
---

<!-- Last reviewed: 2026-04-20 -->

# app-host -- Rules & Patterns

Project collection management, project file storage, and persistence for
Mindcraft host apps. Apps (e.g. `apps/ecosim`) depend on this package for named
project collections, named projects, in-memory project file systems, and
IDB-backed persistence. No dependency on
`bridge-app`, `bridge-client`, or `bridge-protocol`.

## Build & Scripts

```
npm run build      # tsc --build (outputs to dist/)
npm run typecheck   # tsc --noEmit
npm run check      # biome check --write
npm test           # tsx --test (node:test runner)
```

After changes, run all three: `npm run typecheck && npm run check && npm test`.
Then rebuild (`npm run build`) so downstream consumers see updated types.
Downstream packages (bridge-app, sim) use composite project references, so
`npx tsc --build` in app-host must succeed before they can typecheck.

## Source Layout

```
src/
  index.ts                        # barrel (all public exports)
  project-manager.ts              # ProjectManager class -- project lifecycle
  project-manager.spec.ts         # tests
  project-store.ts                # ProjectStore interface
  idb-project-store.ts            # IndexedDB implementation of ProjectStore
  project-collection.ts           # ProjectCollection type and default constants
  project-manifest.ts             # ProjectManifest type
  project-lock.ts                 # Web Locks API for multi-tab safety
  project-file-system.ts          # ProjectFileSystem interface
  project-file-snapshot.ts        # ProjectFileSnapshot, ProjectFileChange types
  in-memory-project-file-system.ts # InMemoryProjectFileSystem implementation
  mindcraft-json.ts               # mindcraft.json parse/serialize
  mindcraft-json.spec.ts
  mindcraft-json-sync.ts          # sync manifest <-> mindcraft.json in project files
  mindcraft-json-sync.spec.ts
  examples.ts                     # ExampleDefinition types, EXAMPLES_FOLDER constant
```

## Key Exports

- `ProjectManager` -- manages project lifecycle: create, open, switch, close,
  delete, duplicate. Owns the active project's file system and coordinates
  debounced auto-save to the store on any project file change.
- `ProjectStore` -- interface for CRUD on project collections, projects,
  project files, and app data. Implemented by `createIdbProjectStore`
  (IndexedDB).
- `ProjectFileSystem` -- interface for an in-memory filesystem: `exportSnapshot`,
  `applyRemoteChange`, `applyLocalChange`, `onLocalChange`, `onAnyChange`,
  `flush`. Implemented by `createInMemoryProjectFileSystem`.
- `ProjectFileChange` -- discriminated union (write, delete, rename, mkdir, rmdir,
  import) describing a single filesystem mutation.
- `ProjectManifest` -- id, name, description, timestamps.
- `createWebLocksProjectLock` -- prevents the same project from being opened in
  multiple browser tabs.
- `syncManifestToMindcraftJson` / `diffMindcraftJsonToManifest` -- keep the
  `mindcraft.json` file in sync with the project manifest.

## Architecture

### Project file lifecycle

`ProjectManager.openInternal` creates a fresh `ProjectFileSystem` and populates
it from the store's saved snapshot via an `import` change. On project close or
switch, `closeInternal` saves the current snapshot back to the store.

### Project restore

`ProjectManager.init` restores the tab's project collection and project from
two `ProjectStore` pointers. The tab session (`getProjectSession`, kept in
`sessionStorage`) wins whenever the tab has one, so a reload restores exactly
what that tab had open. A tab with no session -- a new tab, or the first tab
after a browser restart -- falls back to the last opened project
(`getLastOpenedProject`, kept in `localStorage`), which the manager writes on
every project open. When neither pointer resolves to a live project, the
manager opens the first project in the collection and creates one if the
collection is empty. A PIN-protected collection still boots locked: restoring
its pointer selects the collection, and the project opens only after unlock.

### Auto-save

`ProjectManager` subscribes to `filesystem.onAnyChange()` and debounces writes
to the store (default 2s). This ensures project file mutations (remote file changes
from the bridge, local edits) survive page reloads without requiring explicit
save. The debounce timer is cleared on project close to avoid stale writes.

`flushAutoSave` cancels the pending debounce and writes immediately, and
`dispose` starts one so every teardown path persists the debounce window.
Host apps flush when the page goes hidden (`visibilitychange` to hidden) and
dispose on `pagehide`, so a backgrounded or closed tab does not drop edits made
inside the debounce window. What the flush can promise is bounded by the store:
`idb-project-store` reads before it writes, so a flush issued as the page is
torn down is best-effort, while a flush in a still-running hidden page
completes normally.

### mindcraft.json filtering

`mindcraft.json` is a generated file synthesized from the project manifest.
`idb-project-store` strips it from project file snapshots before persisting to
avoid storing derived data.

## Testing

Tests use `node:test` and `node:assert/strict`. Test files are colocated with
source (`*.spec.ts`) and excluded from the build tsconfig.

Current test files:
- `idb-project-store.spec.ts` -- IndexedDB ProjectStore behavior
- `project-manager.spec.ts` -- ProjectManager lifecycle, auto-save, events
- `mindcraft-json.spec.ts` -- parse/serialize round-trips
- `mindcraft-json-sync.spec.ts` -- manifest <-> mindcraft.json sync

## Rules

- Zero dependencies on bridge-protocol, bridge-client, or bridge-app. This
  package is a foundation layer that host apps and bridge-app build on.
- All exports go through `src/index.ts`. Consumers import from
  `@mindcraft-lang/app-host`.
- `ProjectFileSystem` is storage-agnostic. The in-memory implementation has no
  persistence logic; persistence is handled by `ProjectManager` + `ProjectStore`.
- Use `import type` for type-only imports.
- `InMemoryProjectFileSystem` fires `onAnyChange` listeners for both remote and local
  changes. `onLocalChange` fires only for `applyLocalChange`.
