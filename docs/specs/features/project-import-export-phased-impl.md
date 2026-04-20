# Project Import/Export -- Phased Implementation

**Spec:** `docs/specs/features/project-import-export.md`
**Date:** 2026-04-19

## Workflow Convention

After implementing a phase, STOP and present the work for review.
Do NOT write the Phase Log, amend the spec, update Current State, or create
repo memory notes during implementation. Those are post-mortem activities
done only when the user says "Run post-mortem for Phase N."

## Current State

Phase 1: not started
Phase 2: not started

---

## Phase 1: Common Layer (packages/app-host)

**Goal:** Implement export and import logic for the common layer (host,
name, description, files, brains). The app layer is handled by a callback
so the host app can plug in its own serialization/deserialization.

### New file: `packages/app-host/src/project-io.ts`

This is the single new source file. It contains types, export helper, and
import function.

### Types to define

```ts
export interface MindcraftExportHost {
  name: string;
  version: string;
}

export interface MindcraftExportFile {
  path: string;
  content: string;
}

export interface MindcraftExportCommon {
  host: MindcraftExportHost;
  name: string;
  description: string;
  files: MindcraftExportFile[];
  brains: Record<string, unknown>;
}

export interface MindcraftExportDocument extends MindcraftExportCommon {
  app?: unknown;
}

export interface ImportDiagnostic {
  severity: "error" | "warning";
  message: string;
}

export interface ImportResult {
  success: boolean;
  projectId: string | undefined;
  diagnostics: ImportDiagnostic[];
}

export interface ImportAppLayerResult {
  diagnostics: ImportDiagnostic[];
}

export type ImportAppLayerCallback = (
  app: unknown,
  hostVersion: string,
) => ImportAppLayerResult;
```

### Export function: `buildExportCommon`

```ts
export function buildExportCommon(
  host: MindcraftExportHost,
  manifest: ProjectManifest,
  workspace: WorkspaceAdapter,
  loadAppData: (key: string) => string | undefined,
): MindcraftExportCommon
```

**Implementation notes:**

1. Call `workspace.exportSnapshot()` to get the `WorkspaceSnapshot` (a
   `Map<string, WorkspaceEntry>`).

2. Iterate entries. For each, include in `files` only if ALL of:
   - `entry.kind === "file"` (skip directories)
   - `!entry.isReadonly` (skip compiler-controlled / example files)
   - `path !== MINDCRAFT_JSON_PATH` (skip `"mindcraft.json"`)
   - `!path.startsWith(EXAMPLES_FOLDER + "/")` (skip `__examples__/...`)

3. For each qualifying file, emit `{ path, content: entry.content }`.

4. Load brains: `const raw = loadAppData("brains")`. If truthy, parse as
   `Record<string, unknown>`. If parsing fails or falsy, use `{}`.

5. Return `{ host, name: manifest.name, description: manifest.description,
   files, brains }`.

**What the app does with the result:** The host app calls this function,
merges in its `app` field to produce a `MindcraftExportDocument`, calls
`JSON.stringify(doc, null, 2)`, and triggers a file download. The app owns
the download; the common layer just builds the data.

### Import function: `importProject`

```ts
export const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export async function importProject(
  file: File,
  hostName: string,
  hostVersion: string,
  projectManager: ProjectManager,
  host: MindcraftJsonHostInfo,
  options?: {
    maxFileSize?: number;
    appLayerCallback?: ImportAppLayerCallback;
  },
): Promise<ImportResult>
```

**Implementation -- step by step. Wrap the entire body in try/catch;
on unexpected error, return `{ success: false, projectId: undefined,
diagnostics: [{ severity: "error", message: e.message ?? "..." }] }`.**

1. **Size check.** If `file.size > (options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE)`,
   return error diagnostic.

2. **Read file.** `const text = await file.text()`.

3. **Parse JSON.** `JSON.parse(text)` in a try/catch. On failure, return
   error diagnostic.

4. **Validate `host.name`.** The parsed JSON must have
   `doc.host?.name === hostName`. If missing or mismatched, return error:
   `"This project was created by ${doc.host?.name ?? "an unknown app"} and
   cannot be imported here."`.

5. **Validate `host.version`.** Compare `doc.host.version` to `hostVersion`
   using semver. If `doc.host.version` is newer (semver greater), return
   error: `"This project was exported by a newer version of ${hostName}
   (${doc.host.version}). Update the app before importing."`.
   - For semver comparison, implement a minimal `compareSemver(a, b)`
     helper that splits on `.`, compares major/minor/patch numerically.
     No need for a full semver library. Pre-release tags are not used in
     this project's versioning.

6. **Validate required fields.** Check that `doc.name` is a string,
   `doc.description` is a string, `doc.files` is an array,
   `doc.brains` is a non-null object. On failure, return error diagnostic
   with a message identifying which field is invalid.

7. **Determine project name.** `const name = typeof doc.name === "string"
   && doc.name.trim() ? doc.name.trim() : DEFAULT_PROJECT_NAME`.

8. **Create project.** `const manifest = await projectManager.create(name)`.
   This also opens it as the active project.

9. **Update description.** `projectManager.updateActive({ description:
   doc.description })`.

10. **Write files.** Collect `warnings: ImportDiagnostic[]`. For each entry
    in `doc.files`:
    - Validate `path` is a string, `content` is a string, path doesn't
      contain `..`, doesn't start with `/`, uses `/` separator. On invalid
      entry, push a warning and skip.
    - Call `projectManager.activeProject!.workspace.applyLocalChange({
      action: "write", path: entry.path, content: entry.content,
      newEtag: crypto.randomUUID() })`.
    - Wrap in try/catch; on failure push warning and continue.

11. **Import brains.** The brains are stored as a `Record<string, unknown>`.
    Save them as-is: `projectManager.saveAppData("brains",
    JSON.stringify(doc.brains))`. Brain validation happens lazily when
    `BrainDef.fromJson()` is called by the host.
    - If the brains value is not an object or serialization fails, push a
      warning and save `"{}"`.

12. **Sync mindcraft.json.** Call `syncManifestToMindcraftJson(
    projectManager.activeProject!.workspace,
    projectManager.activeProject!.manifest, host)`.

13. **Flush workspace.** Call `projectManager.activeProject!.workspace.flush()`
    to ensure all writes are persisted.

14. **App layer.** If `options?.appLayerCallback` is provided and
    `doc.app !== undefined`, call it: `const appResult =
    options.appLayerCallback(doc.app, doc.host.version)`. Merge its
    diagnostics. If `doc.app` is undefined and callback is provided,
    push a warning: `"No app-specific data found in the export file.
    Using defaults."`.

15. **Return result.** `{ success: true, projectId: manifest.id,
    diagnostics: warnings }`.

### Exports to add to `packages/app-host/src/index.ts`

```ts
export type {
  ImportAppLayerCallback,
  ImportAppLayerResult,
  ImportDiagnostic,
  ImportResult,
  MindcraftExportCommon,
  MindcraftExportDocument,
  MindcraftExportFile,
  MindcraftExportHost,
} from "./project-io.js";
export { buildExportCommon, DEFAULT_MAX_FILE_SIZE, importProject } from "./project-io.js";
```

### Test file: `packages/app-host/src/project-io.spec.ts`

Use `node:test` (`describe`, `it`) and `node:assert/strict`.

**Mock setup:** Follow the pattern from `mindcraft-json-sync.spec.ts`.
Create a `makeWorkspace()` helper that returns a `WorkspaceAdapter` backed
by an in-memory `Map`. Create a mock `ProjectManager` or use the real one
with an in-memory `ProjectStore`.

For a real `ProjectManager`, the test file can use
`createLocalStorageProjectStore` with a mock `localStorage` (use the
pattern already established in `local-storage-project-store.spec.ts`).
Alternatively, create a minimal in-memory `ProjectStore` implementation
for tests.

**Test cases for `buildExportCommon`:**

1. Exports user files, excludes `mindcraft.json`.
2. Excludes read-only files.
3. Excludes `__examples__/` paths.
4. Excludes directory entries.
5. Loads and includes brains from app data.
6. Returns empty brains object when no brain data stored.
7. Returns empty files array when workspace has no user files.

**Test cases for `importProject`:**

1. Rejects files over size limit.
2. Rejects invalid JSON.
3. Rejects mismatched `host.name`.
4. Rejects missing `host.name`.
5. Rejects newer `host.version`.
6. Accepts same `host.version`.
7. Accepts older `host.version`.
8. Rejects missing required fields (name, description, files, brains).
9. Substitutes `DEFAULT_PROJECT_NAME` when name is empty/whitespace.
10. Creates project and writes files to workspace.
11. Skips invalid file entries with warning diagnostic.
12. Saves brains to app data.
13. Calls `syncManifestToMindcraftJson`.
14. Calls app layer callback when `app` is present.
15. Records warning when `app` is missing but callback is provided.
16. Never throws -- catches unexpected errors and returns error diagnostic.
17. Validates file paths (rejects `..`, leading `/`).

**Creating a mock `File` object for tests:** Node.js 20+ has a global
`File` class (from `node:buffer`). Construct with
`new File([content], "test.mindcraft", { type: "application/json" })`.
To test size limits, construct a File whose `.size` exceeds the limit.

### Verification

```bash
cd packages/app-host
npm run typecheck && npm run check && npm run build && npm test
```

All must pass.

---

## Phase 2: Sim Integration (apps/sim)

**Goal:** Wire export and import into the sim app's UI via the hamburger
menu. The sim provides its app-specific serializer/deserializer.

### Overview of the sim's relevant architecture

- **Package identity:** `@mindcraft-lang/sim` (from `apps/sim/package.json`).
  The `name` and `version` are imported as `simName` and `simVersion` in
  `sim-environment-store.ts`.

- **SimEnvironmentStore** (`apps/sim/src/services/sim-environment-store.ts`):
  Singleton Zustand-like store. Holds `this.host` (an `AppEnvironmentHost`).
  Accessed in components via `useSimEnvironment()` hook.

- **AppEnvironmentHost** (`packages/bridge-app/src/app-environment-host.ts`):
  Manages `ProjectManager`, workspace, compilation, brain cache. Has
  `switchProject(id)` which re-initializes the compiler.

- **Brain storage:** Brains are stored as app data under key `"brains"` via
  `projectManager.saveAppData("brains", JSON.stringify(record))`. The
  record is keyed by opaque string identifiers (currently archetype names
  like `"carnivore"`, `"herbivore"`, `"plant"`). Loaded via
  `projectManager.loadAppData("brains")`.

- **Population counts:** Stored in sim-only localStorage via
  `population-persistence.ts`:
  - `loadDesiredCounts(): Record<Archetype, number>`
  - `saveDesiredCounts(counts): void`
  - Storage key: `"population-desired-counts"` (global, not per-project)

- **Archetype type:** `type Archetype = "carnivore" | "herbivore" | "plant"`
  (defined in `apps/sim/src/brain/actor.ts`).

- **Archetype configs:** `ARCHETYPES` constant in
  `apps/sim/src/brain/archetypes.ts`. Maps archetype name to
  `ArchetypeConfig` which includes `initialSpawnCount`.

- **Hamburger menu:** `ProjectHeader.tsx`
  (`apps/sim/src/components/ProjectHeader.tsx`). Uses
  `DropdownMenu`/`DropdownMenuItem` from `@mindcraft-lang/ui`. Currently
  has "New Project" and "Browse Projects" items. The component receives
  `onBrowseProjects` and `onNewProject` callbacks as props. It is rendered
  in `App.tsx`.

- **No existing file download or upload patterns** in the sim codebase.
  Both must be implemented from scratch.

### Step 1: Add export method to SimEnvironmentStore

Add a method `exportProject(): string` that:

1. Gets `manifest`, `workspace`, and `loadAppData` from `this.host`.
2. Calls `buildExportCommon(...)` with the host info
   (`{ name: simName, version: simVersion }`).
3. Builds the sim app layer: iterate the known archetypes and for each,
   emit `{ archetype, brain: archetypeKey, desiredCount }`.
   - Load `desiredCount` from `loadDesiredCounts()`.
   - The brain key is the same as the archetype key (the sim currently
     keys brains by archetype name).
   - If the archetype has no brain (e.g. plant), set `brain` to `null`.
     Check if the brain record has a key for this archetype; if not, null.
4. Assemble `MindcraftExportDocument`:
   `{ ...common, app: { actors } }`.
5. Return `JSON.stringify(doc, null, 2)`.

### Step 2: Add import method to SimEnvironmentStore

Add an async method `importProject(file: File): Promise<ImportResult>` that:

1. Calls `importProject()` from `@mindcraft-lang/app-host`, passing:
   - `file`
   - `hostName: simName`
   - `hostVersion: simVersion`
   - `this.host.projectManager`
   - `{ name: simName, version: simVersion }` as the host info
   - `appLayerCallback` that deserializes the sim's `app` section
2. The app layer callback:
   - Expects `app` to have an `actors` array.
   - For each actor entry, validate `archetype` is a known `Archetype`.
     Skip unknown archetypes with a warning.
   - Extract `desiredCount`, clamp to a valid range (e.g. 0-100).
   - Call `saveDesiredCounts(counts)` with the assembled counts.
   - Brain references are already saved in the common layer step (as the
     brains record). No additional brain wiring is needed here.
   - Return `{ diagnostics }`.
3. After import succeeds, the project is already open (the common layer
   called `projectManager.create()` which opens it). However, the
   `AppEnvironmentHost`'s compiler is not re-initialized. Call
   `this.host.switchProject(result.projectId!)` to fully activate the
   new project (this re-runs `initCompiler`, loads brains from project,
   fires project-loaded listeners).
4. Return the `ImportResult`.

### Step 3: File download utility

Create `apps/sim/src/utils/file-download.ts`:

```ts
export function downloadTextFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

### Step 4: File upload utility

Create `apps/sim/src/utils/file-upload.ts`:

```ts
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => {
      resolve(input.files?.[0] ?? null);
    });
    input.click();
  });
}
```

### Step 5: Add menu items to ProjectHeader

Update `ProjectHeader.tsx`:

1. Add two new props: `onExportProject` and `onImportProject`.
2. Add two `DropdownMenuItem` entries to the dropdown menu, after the
   existing items. Use a `DropdownMenuSeparator` to visually separate
   them from the project management items:
   - "Export Project" with a `Download` icon (from `lucide-react`)
   - "Import Project" with an `Upload` icon (from `lucide-react`)

### Step 6: Wire menu items in App.tsx

In `App.tsx`:

1. Create `handleExportProject` callback:
   - Call `store.exportProject()` to get the JSON string.
   - Sanitize the project name for use as a filename (replace
     non-alphanumeric chars with `-`, trim, lowercase).
   - Call `downloadTextFile(json, `${safeName}.mindcraft`)`.

2. Create `handleImportProject` callback:
   - Call `pickFile(".mindcraft,.json")` to get the file.
   - If null (user cancelled), return.
   - Call `store.importProject(file)`.
   - If `result.success`, optionally show a toast or notification.
   - If `!result.success` or there are error diagnostics, show an error
     dialog or toast with the diagnostic messages.
   - For warning diagnostics on a successful import, show a notification
     listing the warnings.

3. Pass both callbacks to `<ProjectHeader>` as `onExportProject` and
   `onImportProject`.

### Step 7: Handle post-import project activation

After `importProject` succeeds and `switchProject` is called, the sim
will re-render because the active project changed. The population
counts were already saved by the app layer callback, so they'll be
picked up by whatever reads `loadDesiredCounts()`.

Verify that:
- Brain definitions load correctly in the brain editor.
- Source files appear in the file tree.
- The project name shows in the header.
- Population counts reflect the imported values.
- Compilation runs and diagnostics are up to date.

### Verification

```bash
cd apps/sim
npm run typecheck && npm run check
```

Manual testing:
1. Create a project with brains and source files. Export it. Verify the
   `.mindcraft` file has the expected JSON structure.
2. Create a new project (or use a different browser/incognito). Import
   the exported file. Verify everything is restored.
3. Try importing a file from a "newer version" -- verify rejection.
4. Try importing a file with a different host name -- verify rejection.
5. Try importing a file over the size limit -- verify rejection.
6. Try importing invalid JSON -- verify rejection.
7. Export a project, modify the file to remove a brain entry, import it.
   Verify partial success with warning diagnostic.

---

## Key Files Reference

### packages/app-host (Phase 1 target)

| File | Role |
|---|---|
| `src/project-io.ts` | NEW. Export/import logic. |
| `src/project-io.spec.ts` | NEW. Tests. |
| `src/index.ts` | Add exports for new types and functions. |
| `src/project-manager.ts` | `ProjectManager` class, `DEFAULT_PROJECT_NAME`. |
| `src/workspace-adapter.ts` | `WorkspaceAdapter` interface. |
| `src/workspace-snapshot.ts` | `WorkspaceSnapshot`, `WorkspaceEntry`, `WorkspaceChange` types. |
| `src/mindcraft-json-sync.ts` | `syncManifestToMindcraftJson`, `MindcraftJsonHostInfo`. |
| `src/mindcraft-json.ts` | `MINDCRAFT_JSON_PATH` constant. |
| `src/examples.ts` | `EXAMPLES_FOLDER` constant. |
| `src/project-manifest.ts` | `ProjectManifest` type. |

### apps/sim (Phase 2 target)

| File | Role |
|---|---|
| `src/services/sim-environment-store.ts` | Add `exportProject()` and `importProject()`. |
| `src/utils/file-download.ts` | NEW. Download helper. |
| `src/utils/file-upload.ts` | NEW. File picker helper. |
| `src/components/ProjectHeader.tsx` | Add Export/Import menu items. |
| `src/App.tsx` | Wire menu callbacks. |
| `src/services/population-persistence.ts` | `loadDesiredCounts`, `saveDesiredCounts`. |
| `src/brain/actor.ts` | `Archetype` type. |
| `src/brain/archetypes.ts` | `ARCHETYPES` constant. |
| `package.json` | Source of `name` and `version` (imported as `simName`/`simVersion`). |

### packages/bridge-app (reference only -- not modified)

| File | Role |
|---|---|
| `src/app-environment-host.ts` | `AppEnvironmentHost` -- has `switchProject()`, `loadBrainRecord()`, `saveBrainForKey()`. |

---

## Build Order

`packages/app-host` must be built before `apps/sim` (it is a dependency via
`packages/bridge-app`). After Phase 1 changes:

```bash
cd packages/app-host && npm run build
```

This makes the new exports available to downstream packages.

---

## Phase Log

(Written during post-mortem only.)
