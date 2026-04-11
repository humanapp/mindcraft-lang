# User Tile Metadata -- Phased Implementation Plan

**Status:** Not started
**Created:** 2026-04-10
**Related:**

- [user-tile-compilation-pipeline.md](user-tile-compilation-pipeline.md)

Adds support for user-authored TypeScript tiles to specify a display label, tile
icon, documentation page, and search tags. Also introduces a `/vfs/` URL scheme
backed by a Service Worker so that workspace files (icons, docs, etc.) are
directly addressable by URL from anywhere in the app -- brain editor, docs pages,
or plain `<img>` tags.

---

## Workflow Convention

Phases here are numbered M1-M10 to avoid collision with other series.

Each phase follows this loop:

1. Agent implements the phase.
2. Agent stops and presents work for review.
3. The user reviews, requests changes or approves.
4. Only after the user declares the phase complete does the post-mortem happen.
5. Agent writes the post-mortem as a Phase Log entry -- with special importance placed on capturing discoveries, unexpected obstacles, compromises made, and surfaced risks. Then update Current State section, and write any repo memory notes to carry forward.

Do NOT write Phase Log entries or amend this spec during implementation. The
Phase Log is a post-mortem artifact.

---

## Current State

Phase M8 complete. The ts-compiler extracts `label`, `icon`, `docs`, and
`tags` from the config AST, resolves icon/docs paths against the workspace
VFS, and passes metadata through to `BrainTileSensorDef`/`BrainTileActuatorDef`
via `ITileMetadata`. 817 ts-compiler tests pass, typecheck and lint clean.

---

## Design

### Author-facing config surface

Users specify optional metadata fields on `SensorConfig` / `ActuatorConfig` in
the ambient `mindcraft.d.ts`:

```typescript
export default Sensor({
  name: "detect-food",
  output: "boolean",
  label: "detect food",             // optional display name (defaults to name)
  icon: "./detect-food.svg",        // optional, relative path in project VFS
  docs: "./detect-food.md",         // optional, relative path in project VFS
  tags: ["sensing", "food"],        // optional, for doc search/categorization
  params: { range: { type: "number", default: 5 } },
  onExecute(ctx, params) { /* ... */ },
});
```

All four new fields (`label`, `icon`, `docs`, `tags`) are optional. When absent,
the tile behaves exactly as it does today.

### Icon format

SVG only. The VFS is text-native (all content is `string`). PNG/JPG would
require binary encoding support across the entire bridge pipeline, which is
deferred. All 59 existing core tile icons are SVG, so this is consistent.

### Icon and docs delivery: `/vfs/` URLs via Service Worker

A Service Worker in `packages/bridge-app` intercepts `fetch` requests matching
`/vfs/*` and serves file content from the workspace VFS snapshot. This makes
every workspace file directly addressable by URL from any context -- `<img>` tags,
CSS `mask-image`, `fetch()`, markdown image references, or browser navigation.

- **On-demand caching**: Cache miss triggers a `postMessage` round-trip to the
  main thread, which reads from the workspace snapshot. The response is cached
  via the Cache API for subsequent fetches.
- **Invalidation**: When a file changes (via `onLocalChange` or
  `applyRemoteChange`), the main thread sends `{ type: "invalidate", path }`
  to the SW, which deletes the cache entry. Next fetch re-populates on demand.
- **Full sync**: On `replaceWorkspace` (import action), clear the entire VFS
  cache. Next fetches re-populate on demand.
- **Content-Type**: Derived from file extension (`.svg` -> `image/svg+xml`,
  `.md` -> `text/markdown`, `.ts` -> `text/plain`, `.json` -> `application/json`,
  etc.). Default: `application/octet-stream`.
- **SW lifecycle**: `skipWaiting()` + `clients.claim()` for immediate activation.
  The SW is a stateless VFS proxy -- no versioned cache logic, no risk of
  serving stale assets to pages loaded with old code.
- **Directory listings**: Requests for `/vfs/` or `/vfs/subdir/` (paths that
  resolve to directories) are handled via `postMessage` to the main thread.
  Returns an HTML page (browsable file list with clickable links) or JSON
  (`Accept: application/json`). Directory listings are not cached.

### Compiler pipeline

The ts-compiler extracts `label`, `icon`, `docs`, and `tags` as static string
values from the config object literal AST (same pattern as `name` and `output`).

- **`icon`**: Normalizes the relative path (strips leading `./`) and stores
  `/vfs/<path>` as `iconUrl` in tile metadata. If the referenced file does not
  exist in the workspace VFS, emits a diagnostic.
- **`docs`**: Reads the `.md` file content from the workspace VFS at compile
  time and stores it as `docsMarkdown` in tile metadata (inlined string). If
  the referenced file does not exist, emits a diagnostic.
- **`tags`**: Forwarded as-is into tile metadata. No explicit `category` field --
  the doc system determines arrangement from tags and tile kind.
- **`label`**: Stored as `label` in tile metadata. Falls back to `name` if
  absent.

### `ITileVisual` -> `ITileMetadata` rename

The existing `ITileVisual` interface (`{ label, iconUrl? }`) is renamed to
`ITileMetadata` and extended:

```typescript
export interface ITileMetadata {
  label: string;
  iconUrl?: string;          // "/vfs/my-icon.svg" or "/assets/brain/icons/random.svg"
  docsMarkdown?: string;     // inlined markdown content for the doc page
  tags?: readonly string[];  // search/categorization tags for the doc system
}
```

The `visual` field on `IBrainTileDef` is renamed to `metadata`. This is a
mechanical rename touching ~16 direct `ITileVisual` references, ~7
`visual.label` reads, ~3 `visual.iconUrl` reads, ~50 test fixture sites, and
the UI-layer extended type `TileVisual`.

The `BrainTileDefCreateOptions.visual` field becomes `metadata`. The
`BrainEditorConfig.resolveTileVisual` callback signature updates to reference
`ITileMetadata` as the core type. The UI-layer `TileVisual` becomes:

```typescript
export type TileVisual = ITileMetadata & { colorDef?: TileColorDef };
```

### Bridge file size limits

New per-file and per-snapshot size limits to prevent accidental or malicious
transfer of oversized content:

| Limit | Value | Enforcement |
|-------|-------|-------------|
| Per-file content | 512 KB | Zod schema (`z.string().max(...)`) + extension-side gating |
| Total snapshot (import action) | 16 MB | Zod schema on import entries array |
| WS message (existing) | 1 MB | Already in `upgrade.ts` |

SVG icons are typically 1-5 KB. TypeScript source files are typically under
50 KB. Markdown docs are typically under 20 KB. The 512 KB per-file limit is
generous while blocking media blobs and accidental binary transfers.

### Doc system integration

When `replaceActionBundle()` runs, the registration layer extracts doc entries
from the bundle's tile metadata and calls `DocsRegistry.register()`:

- `tileId` is the key.
- `tags` come from tile metadata.
- `content` is the `docsMarkdown` string.
- Category is derived from tile kind (e.g., user sensors -> "Sensors", user
  actuators -> "Actuators") or from a well-known tag if the doc system supports
  it.

The `UserTileMetadataCache` in localStorage gains `docsMarkdown?` and `tags?`
per entry so hydrated user tiles appear in docs before compilation runs.

---

## Scope

### In scope

- Optional `label`, `icon`, `docs`, `tags` fields on `SensorConfig` and
  `ActuatorConfig`.
- `ITileVisual` -> `ITileMetadata` rename across the codebase.
- Service Worker in `packages/bridge-app` serving `/vfs/*` URLs.
- On-demand Cache API population with invalidation on file changes.
- Browsable `/vfs/` directory listings (HTML and JSON).
- Per-file and per-snapshot size limits on bridge protocol.
- Compiler extraction of new config fields into tile metadata.
- Doc registry population from user tile metadata.
- Metadata cache extension for docs/tags.

### Out of scope

- PNG/JPG icon support (requires binary encoding in VFS pipeline).
- Custom doc categories (derived from tile kind for now).
- Tile icon animation or interactive SVG.
- Docs editing from within the sim app.

---

## Phased Plan

### Phase M1: Bridge file size limits

**Goal:** Add per-file content size limits to the bridge protocol and enforce
them at the schema and extension layers. This is a safety measure independent
of all other phases.

**Changes:**

1. **packages/bridge-protocol -- `notifications.ts`**: Add a
   `MAX_FILE_CONTENT_BYTES` constant (512 KB). Add `.max(MAX_FILE_CONTENT_BYTES)`
   to the `content: z.string()` field in the `write` action schema. Add a total
   size validator on the `import` action's `entries` array (16 MB total content).

2. **packages/bridge-client -- `NotifyingFileSystem`**: In the `write()` method,
   check `content.length` against the limit before emitting the notification. If
   over the limit, skip the notification and log a warning.

3. **Tests**: Verify that oversized content is rejected by schema validation.
   Verify that the NotifyingFileSystem silently skips oversized writes.

**Verification:** `npm run typecheck && npm run check` in bridge-protocol and
bridge-client.

---

### Phase M2: `ITileVisual` -> `ITileMetadata` rename

**Goal:** Rename the interface and field across the entire codebase. No
functional changes -- pure mechanical rename.

**Changes:**

1. **packages/core -- `interfaces/tiles.ts`**: Rename `ITileVisual` to
   `ITileMetadata`. Add `docsMarkdown?: string` and
   `tags?: readonly string[]` fields to the interface. Rename
   `BrainTileDefCreateOptions.visual` to `metadata`. Rename
   `IBrainTileDef.visual` to `metadata`.

2. **packages/core**: Update all references to the old names across:
   - `model/tiledef.ts` (BrainTileDefBase constructor and field)
   - `model/braindef.ts` (page tile label mutation)
   - `tiles/pagetiles.ts` (serialization/deserialization)
   - `tiles/missing.ts` (missing tile fallback)
   - `mindcraft.ts` (modifier/parameter tile registration)
   - `index.ts` and `app/index.ts` (re-exports)

3. **packages/ui**: Update `TileVisual` type to extend `ITileMetadata` instead
   of `ITileVisual`. Update `resolveTileVisual()` in `tile-visual-utils.ts`
   to read `tileDef.metadata`. Update all components that access `visual`
   (`BrainTile.tsx`, `BrainPrintView.tsx`, `BrainTilePickerDialog.tsx`,
   clipboard helpers).

4. **packages/docs**: Update `DocsSidebar.tsx`, `DocsRule.tsx`,
   `DocMarkdown.tsx`, `DocsPrintView.tsx`, `DocsSidebarContext.tsx` to read
   `metadata` instead of `visual`.

5. **apps/sim**: Update `visual-provider.ts`, `tile-visuals.ts`, `config.tsx`,
   and any other sim-specific code referencing `visual` on tile defs.

6. **Test fixtures**: Update all test files that construct tile defs with
   `visual: { ... }` to use `metadata: { ... }`.

**Verification:** `npm run typecheck && npm run check` in packages/core,
packages/ui, packages/docs, and apps/sim.

---

### Phase M3: Service Worker -- scaffold and registration

**Goal:** Create the Service Worker file in `packages/bridge-app`, register it
from the app layer, and establish the `postMessage` communication channel
between the SW and the main thread. No `/vfs/` serving yet -- just the
infrastructure.

**Changes:**

1. **packages/bridge-app -- `src/vfs-service-worker.ts`**: Create the SW file.
   On `install`: call `self.skipWaiting()`. On `activate`: call
   `self.clients.claim()`. On `fetch`: no-op passthrough (`return` without
   calling `event.respondWith`). On `message`: log and acknowledge.

2. **packages/bridge-app -- `src/vfs-sw-registration.ts`**: Export a
   `registerVfsServiceWorker()` function that calls
   `navigator.serviceWorker.register()` with the SW URL. This function also
   sets up the `postMessage` listener for SW -> main thread requests and
   connects it to the workspace adapter's `exportSnapshot()`.

3. **apps/sim -- `bootstrap.ts`**: Call `registerVfsServiceWorker()` during
   app initialization, after workspace store init.

4. **Build integration**: The SW file must be built as a separate entry point
   (not bundled into the app). Add the appropriate Vite config to emit the SW
   as a standalone file. This may require a Vite plugin or a manual
   `build.rollupOptions.input` entry.

**Verification:** App loads without errors. SW appears in browser DevTools
under Application > Service Workers. `postMessage` round-trip works (verify
via console log).

---

### Phase M4: Service Worker -- `/vfs/` file serving

**Goal:** The SW intercepts `/vfs/*` fetch requests and serves file content
from the workspace VFS via the main thread.

**Changes:**

1. **SW fetch handler**: For requests matching `/vfs/*`:
   - Strip the `/vfs/` prefix to get the workspace path.
   - Check Cache API first. If hit, return cached response.
   - On cache miss, send `postMessage` to main thread:
     `{ type: "vfs-read", path }`.
   - Main thread handler reads from `exportSnapshot().get(path)`.
   - If file exists: respond with `{ type: "vfs-read-response", path, content, found: true }`.
   - If not found: respond with `{ type: "vfs-read-response", path, found: false }`.
   - SW constructs a `Response` with appropriate `Content-Type` header (derived
     from file extension) and caches it before returning.
   - If not found, return a `404` response.

2. **Content-Type mapping**: A utility function mapping file extensions to MIME
   types. Minimum set: `.svg` -> `image/svg+xml`, `.md` -> `text/markdown`,
   `.ts` -> `text/plain`, `.json` -> `application/json`, `.txt` -> `text/plain`.
   Default: `application/octet-stream`.

3. **Tests**: Manual verification -- create a file in the VFS via the bridge,
   then fetch `/vfs/<path>` from the browser and confirm the content is served
   with the correct Content-Type.

**Verification:** `fetch("/vfs/some-file.svg")` from browser console returns
the file content with `Content-Type: image/svg+xml`.

---

### Phase M5: Service Worker -- cache invalidation

**Goal:** When workspace files change, invalidate the corresponding cache
entries so the next fetch serves fresh content.

**Changes:**

1. **packages/bridge-app -- `vfs-sw-registration.ts`**: In the main-thread
   registration module, listen for workspace changes via
   `workspaceAdapter.onLocalChange()` and the bridge's remote change path.
   On file `write` or `delete`: send `postMessage` to SW:
   `{ type: "vfs-invalidate", path }`. On `rename`: invalidate both old and
   new paths. On `import` (full sync): send `{ type: "vfs-invalidate-all" }`.

2. **SW message handler**: On `vfs-invalidate`: delete the cache entry for
   `/vfs/<path>`. On `vfs-invalidate-all`: clear the entire VFS cache
   (`caches.delete("vfs")`).

3. **Tests**: Manual verification -- update a file via the bridge, confirm that
   re-fetching `/vfs/<path>` returns the new content.

**Verification:** Modify a VFS file, fetch it again, confirm content is updated.

---

### Phase M6: Service Worker -- directory listings

**Goal:** Requests for `/vfs/` or `/vfs/subdir/` return a browsable directory
listing.

**Changes:**

1. **SW fetch handler**: After the file-serving path, detect directory requests
   (path ends with `/` or no cache hit and no file extension). Send
   `postMessage` to main thread: `{ type: "vfs-list", path }`.

2. **Main thread handler**: Read the workspace snapshot. Collect all entries
   whose path starts with the requested prefix and is one level deep (direct
   children). Return `{ type: "vfs-list-response", path, entries }` where each
   entry has `{ name, kind: "file" | "directory" }`.

3. **SW response**: If `Accept` header includes `application/json`, return JSON.
   Otherwise return an HTML page with a simple file browser:
   - Page title shows the current path.
   - Directories are listed with trailing `/` and link deeper.
   - Files link to `/vfs/<full-path>`.
   - Parent directory link (`..`) for non-root paths.
   - Minimal inline CSS for readability.

4. **Directory listings are not cached** (always fresh via `postMessage`).

**Verification:** Navigate to `http://localhost:8080/vfs/` in a browser and see
the file listing. Click through directories and files.

---

### Phase M7: Extend `SensorConfig` / `ActuatorConfig` ambient types

**Goal:** Add `label`, `icon`, `docs`, and `tags` to the ambient type
declarations so users get autocomplete and type checking for these fields.

**Changes:**

1. **packages/ts-compiler -- `ambient.ts`**: Extend `SensorConfig` and
   `ActuatorConfig` interfaces in the generated `mindcraft.d.ts`:

   ```typescript
   export interface SensorConfig {
     name: string;
     output: MindcraftType;
     label?: string;
     icon?: string;
     docs?: string;
     tags?: string[];
     params?: Record<string, ParamDef>;
     onExecute(ctx: Context, params: Record<string, unknown>): unknown;
     onPageEntered?(ctx: Context): void;
   }

   export interface ActuatorConfig {
     name: string;
     label?: string;
     icon?: string;
     docs?: string;
     tags?: string[];
     params?: Record<string, ParamDef>;
     onExecute(ctx: Context, params: Record<string, unknown>): void | Promise<void>;
     onPageEntered?(ctx: Context): void;
   }
   ```

2. **Tests**: Compile a tile with all four new fields set. Verify no TypeScript
   errors from the ambient type check.

**Verification:** `npm run typecheck && npm run check && npm test` in
packages/ts-compiler.

---

### Phase M8: Compiler extraction of metadata fields

**Goal:** The compiler extracts `label`, `icon`, `docs`, and `tags` from the
config object literal and stores them in `ExtractedDescriptor` and
`UserAuthoredProgram`.

**Changes:**

1. **packages/ts-compiler -- descriptor extractor**: Extend the descriptor
   extraction to read `label`, `icon`, `docs`, and `tags` from the config AST.
   These are static string values (or string array for tags). Store on
   `ExtractedDescriptor` as `label?: string`, `icon?: string`,
   `docs?: string`, `tags?: string[]`.

2. **packages/ts-compiler -- `types.ts`**: Add `label?: string`,
   `iconUrl?: string`, `docsMarkdown?: string`, `tags?: string[]` to
   `UserAuthoredProgram`.

3. **packages/ts-compiler -- program builder**: After extraction, resolve
   `icon` and `docs` paths:
   - `icon`: Normalize relative path, prepend `/vfs/`, store as `iconUrl`.
     If the workspace VFS does not contain the file, emit a diagnostic.
   - `docs`: Read the `.md` file content from the workspace VFS, store as
     `docsMarkdown`. If the file does not exist, emit a diagnostic.
   - `label`: Store directly. Default to `name` if absent.
   - `tags`: Store directly as string array.

4. **packages/ts-compiler -- `user-tile-metadata.ts`**: Pass `label`, `iconUrl`,
   `docsMarkdown`, and `tags` through to the `ITileMetadata` on the constructed
   `BrainTileSensorDef` / `BrainTileActuatorDef`.

5. **Tests**: Compile a tile with `icon: "./my-icon.svg"` (file present in VFS).
   Verify the compiled program's `iconUrl` is `"/vfs/my-icon.svg"`. Compile a
   tile with `icon: "./missing.svg"` (file absent). Verify a diagnostic is
   emitted. Same for `docs`.

**Verification:** `npm run typecheck && npm run check && npm test` in
packages/ts-compiler.

---

### Phase M9: Doc system integration

**Goal:** User tiles with `docsMarkdown` appear in the docs sidebar and have
viewable doc pages.

**Changes:**

1. **packages/docs -- `DocsRegistry.ts`**: No interface changes needed -- the
   existing `DocsTileEntry` schema (`tileId`, `tags`, `category`, `content`)
   is sufficient.

2. **App-level registration bridge** (e.g., `apps/sim/src/services/user-tile-registration.ts`
   or a new module): After `replaceActionBundle()`, iterate the bundle's tile
   defs. For each tile with `metadata.docsMarkdown`, construct a `DocsTileEntry`
   and register it:
   - `tileId`: from the tile def.
   - `tags`: from `metadata.tags` (or empty array).
   - `category`: Derive from tile kind -- `"Sensors"` for sensors,
     `"Actuators"` for actuators.
   - `content`: `metadata.docsMarkdown`.

3. **apps/sim -- `user-tile-registration.ts`**: Extend metadata cache schema
   (`UserTileMetadataCache`) to include `docsMarkdown?` and `tags?` per entry.
   Update `buildHydratedSnapshot()` to set these on tile metadata. Update
   `collectMetadataFromCompile()` to extract them from compile results.

4. **Hydration path**: When hydrating from cache at startup, also register doc
   entries from cached metadata into `DocsRegistry`.

5. **Tests**: Manual or integration verification -- compile a tile with
   `docs: "./my-tile.md"`, verify the tile appears in the docs sidebar with the
   correct content.

**Verification:** `npm run typecheck && npm run check` in packages/docs and
apps/sim.

---

### Phase M10: End-to-end integration test

**Goal:** Verify the full pipeline works: a user writes a tile with `label`,
`icon`, `docs`, and `tags` in VS Code, it compiles, the icon renders in the
brain editor via `/vfs/` URL, and the tile appears in the docs sidebar with its
doc page.

**Changes:**

1. Create a sample user tile project with:
   - `detect-food.ts` -- sensor with all four metadata fields.
   - `detect-food.svg` -- simple SVG icon.
   - `detect-food.md` -- markdown doc page.

2. Verify through manual testing:
   - Tile compiles without diagnostics.
   - Brain editor shows the custom icon (not the question-mark fallback).
   - Docs sidebar lists the tile under "Sensors" with correct tags.
   - Clicking the tile in docs shows the markdown page.
   - `/vfs/detect-food.svg` is directly accessible from the browser.
   - `/vfs/` shows a browsable directory listing.
   - Modifying the SVG in VS Code updates the icon in the brain editor.

**Verification:** Full manual walkthrough of the pipeline.

---

## Gotchas and Risk Notes

1. **Service Worker activation timing**: On first page load (or after SW
   update), the SW may not be controlling the page immediately. Using
   `skipWaiting()` + `clients.claim()` mitigates this. User tiles are not
   visible until after the bridge connects, which happens well after SW
   activation, so the timing risk is low in practice.

2. **`postMessage` availability**: The SW `postMessage` channel requires at
   least one controlled client. If the SW is active but no client has set up
   the message listener, file requests will hang. The registration module must
   set up the listener eagerly during `registerVfsServiceWorker()`.

3. **Cache staleness**: On-demand caching means a file could be cached, then
   deleted from the VFS, and the cache entry would persist until explicitly
   invalidated. The invalidation listener (M5) must handle `delete` actions
   in addition to `write` actions.

4. **Directory detection in SW**: The SW needs to distinguish file requests
   from directory requests. Strategy: try cache first (file hit = serve it),
   then `postMessage` for directory listing, then 404. A path like `/vfs/foo`
   with no extension could be a file or a directory -- the main thread resolves
   ambiguity by checking the snapshot.

5. **Large docs content**: A user could reference a very long `.md` file. The
   512 KB per-file bridge limit already constrains this. The inlined
   `docsMarkdown` in tile metadata and the localStorage cache will carry this
   content. This is acceptable -- markdown is compact.

6. **ITileMetadata rename scope**: The rename touches packages/core, packages/ui,
   packages/docs, and apps/sim. All changes are mechanical but span many files.
   Phase M2 should be done as a focused rename-only change to minimize merge
   conflicts.

7. **Build integration for SW**: The Service Worker file must be emitted as a
   standalone JS file, not bundled into the app. Vite supports this via
   `import.meta.url` + `new URL()` pattern or via explicit `build.rollupOptions`
   configuration. The exact approach depends on the Vite version and plugin
   ecosystem in use.

8. **Cross-origin restrictions**: Service Workers only work on same-origin
   requests. The `/vfs/` URL scheme is same-origin by construction (relative
   path), so no CORS issues.

---

## Phase Log

### M1 -- Bridge file size limits

Added `MAX_FILE_CONTENT_BYTES` (512 KB) and `MAX_SNAPSHOT_CONTENT_BYTES`
(16 MB) to bridge-protocol. Zod schemas gained `.max()` on content fields
and `.refine()` on snapshot entries. `NotifyingFileSystem.write()` returns
`WriteResult` (`{ etag, oversized? }`) and suppresses notifications for
oversized files. 121 bridge-client tests pass.

### M2 -- ITileVisual -> ITileMetadata rename

Renamed `ITileVisual` to `ITileMetadata` with new fields `docsMarkdown?`
and `tags?`. Renamed `.visual` to `.metadata` on `IBrainTileDef`,
`BrainTileDefCreateOptions`, and all consumers across packages/core (8 files),
packages/ui (4), packages/docs (1), apps/sim (10), test fixtures (2).
557 core tests pass.

### M3 -- Service Worker scaffold and registration

**bridge-app:**
- `src/vfs-service-worker.ts` -- SW with skipWaiting, clients.claim, no-op
  fetch, message handler returning vfs-ack. Uses inline interfaces to avoid
  webworker lib conflicts.
- `src/vfs-sw-registration.ts` -- `registerVfsServiceWorker({ swUrl, workspace })`.
  Registers SW with `type: "module"`, sets up message listener stub.
- `src/index.ts` -- exports new function and type.
- `package.json` -- added `./vfs-service-worker` subpath export.

**apps/sim:**
- `src/vfs-sw-entry.ts` -- thin entry importing bridge-app's SW module.
- `src/services/vfs-service-worker.ts` -- `initVfsServiceWorker()` picks URL
  by `import.meta.env.DEV`, calls registration with workspace adapter.
- `src/bootstrap.ts` -- calls `initVfsServiceWorker()`.
- `vite/config.prod.mjs` -- second Rollup input for SW; `entryFileNames`
  routes it to `/vfs-service-worker.js` (no content hash).

### M4 -- Service Worker `/vfs/` file serving

**bridge-app/src/vfs-service-worker.ts:**
- `fetch` handler intercepts `/vfs/*` URLs. Cache hit -> return cached.
  Cache miss -> `MessageChannel` round-trip to main thread via
  `client.postMessage({ type: "vfs-read", path }, [port])`. Builds
  `Response` with correct Content-Type, caches it, returns it. 404 on
  not-found or no client.
- `mimeForPath()` maps extensions to MIME types: svg, png, jpg, jpeg, gif,
  webp, md, ts, json, txt. Default: `application/octet-stream`.
- Expanded inline interfaces for `caches`, `clients.matchAll()`,
  `event.request`, `event.respondWith()`.

**bridge-app/src/vfs-sw-registration.ts:**
- Message listener handles `vfs-read`: reads path from workspace adapter's
  `exportSnapshot()`, replies on `MessagePort` with `{ found, content }`.

### M5 -- Service Worker cache invalidation

**bridge-app/src/vfs-service-worker.ts:**
- SW `message` handler processes `vfs-invalidate` (deletes specific URL from
  `"vfs"` cache) and `vfs-invalidate-all` (deletes entire cache bucket).
- Added `delete()` to `VfsSwCache` and `caches` interfaces.

**bridge-app/src/vfs-sw-registration.ts:**
- `invalidateForChange()` maps change actions to SW messages: `write`/`delete`
  -> `vfs-invalidate`, `rename` -> invalidate both paths, `import` ->
  `vfs-invalidate-all`.
- `registerVfsServiceWorker()` subscribes to `workspace.onLocalChange()`.
- New exported `invalidateVfsCache(change)` for external callers.

**bridge-app/src/index.ts:**
- Exports `invalidateVfsCache`.

**apps/sim/src/services/vscode-bridge.ts:**
- `wireBridgeState()` subscribes to `bridge.onRemoteChange(invalidateVfsCache)`
  so remote changes also invalidate the VFS cache.

### M6 -- Service Worker directory listings

Skipped. Directory listing is not needed for the initial feature set and can
be added later if/when needed.

### M7 -- Extend SensorConfig / ActuatorConfig ambient types

**packages/ts-compiler/src/compiler/ambient.ts:**
- Added `label?: string`, `icon?: string`, `docs?: string`, `tags?: string[]`
  to both `SensorConfig` and `ActuatorConfig`.

**packages/ts-compiler/src/compiler/ambient.spec.ts:**
- New test compiles sensor and actuator with all four metadata fields, verifies
  zero diagnostics.

809 tests pass.

### M8 -- Compiler extraction of metadata fields

**packages/ts-compiler/src/compiler/diag-codes.ts:**
- Added `DescriptorDiagCode` entries 2020-2024: `LabelMustBeStringLiteral`,
  `IconMustBeStringLiteral`, `DocsMustBeStringLiteral`,
  `TagsMustBeArrayLiteral`, `TagElementMustBeStringLiteral`.
- Added `CompileDiagCode.MetadataFileNotFound` (5006) for missing icon/docs
  files in the workspace VFS.

**packages/ts-compiler/src/compiler/types.ts:**
- New `SourceSpan` interface (`line`, `column`, `endLine`, `endColumn`).
- `ExtractedDescriptor` gained `label?`, `icon?`, `iconSpan?`, `docs?`,
  `docsSpan?`, `tags?`.
- `UserAuthoredProgram` gained `label?`, `iconUrl?`, `docsMarkdown?`,
  `tags?`.

**packages/ts-compiler/src/compiler/descriptor.ts:**
- New `spanOf()` helper captures 1-based line/column spans from AST nodes.
- Four new `case` branches in the property switch: `label` (string literal),
  `icon` (string literal + span), `docs` (string literal + span), `tags`
  (array of string literals). All produce typed diagnostics on bad input.
- Returned descriptor includes all new fields.

**packages/ts-compiler/src/compiler/project.ts:**
- New `resolveRelativePath()` helper normalizes `../` and `./` in paths.
- After descriptor extraction, resolves `icon` relative to source file,
  checks `_files` for existence, stores `/vfs/<path>` as `iconUrl` or emits
  `MetadataFileNotFound` warning with span info.
- Resolves `docs` the same way, reads `.md` content from `_files` into
  `docsMarkdown` or emits warning with span info.
- `label` defaults to `name`; `tags` passed through.

**packages/ts-compiler/src/runtime/user-tile-metadata.ts:**
- `buildUserTileMetadata()` constructs an `ITileMetadata` object from the
  program's `label`, `iconUrl`, `docsMarkdown`, `tags` and passes it as
  `opts.metadata` to `BrainTileSensorDef`/`BrainTileActuatorDef` constructors.

**packages/ts-compiler/src/compiler/metadata.spec.ts (new):**
- 8 tests: full extraction, label defaulting, missing icon warning, missing
  docs warning, subdirectory path resolution, label/tags/tag-element
  validation diagnostics.

**packages/ts-compiler/src/compiler/ambient.spec.ts:**
- Updated M7 test to filter for errors only (warnings about missing files
  are expected since single-file compile has no VFS siblings).

Discoveries:
- `MetadataFileNotFound` diagnostics initially lacked span info (reported as
  1:1). Fixed by storing `iconSpan`/`docsSpan` on `ExtractedDescriptor` and
  spreading them into the diagnostic.
- TS type-checking runs before descriptor extraction, so tests for bad types
  (e.g., `tags: "string"`) need `as any` casts to bypass TS and reach the
  descriptor validator.

817 tests pass (8 new).

