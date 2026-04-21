# Projects -- Phased Implementation Plan

**Status:** Not started
**Created:** 2026-04-18

A project is a named container for mindcraft brain code, user-authored TypeScript
code, and app-specific data (brains, settings). Projects are stored in
localStorage, scoped per host app by package name prefix. Apps present a project
picker dialog and persist the active project across sessions.

---

## Workflow Convention

Phases here are numbered P1-P7 to avoid collision with existing series.

Each phase follows this loop:

1. **Kick off** -- "Implement Phase N." The implementer reads this doc, the spec,
   and any relevant instruction files before writing code. After implementation,
   STOP and present the work for review. Do not write the Phase Log entry, amend
   the spec, update the Current State section, or perform any post-mortem activity.
2. **Review + refine** -- Followup prompts within the same conversation.
3. **Declare done** -- "Phase N is complete." Only the user can declare the phase
   complete. Do not move to the post-mortem step until the user requests it.
4. **Post-mortem** -- "Run post-mortem for Phase N." This step:
   - Diffs planned deliverables vs what was actually built.
   - Records the outcome in the Phase Log (bottom of this doc). The Phase Log is
     a post-mortem artifact -- never write it during implementation.
   - Amends this doc with dated notes if the spec was wrong or underspecified.
   - Propagates discoveries to upcoming phases (updated risks, changed
     deliverables, new prerequisites).
   - Writes a repo memory note with key decisions for future conversations.
5. **Next phase** -- New conversation (or same if context is not exhausted).

---

## Current State

- (2026-04-18) Phase P7 complete. All phases done. Project management UI
  wired into sim: hamburger menu, inline rename, picker dialog, new project dialog.

---

## Design Summary

### Package layout after refactor

```
packages/app-host/       NEW -- project management, workspace storage
packages/bridge-app/     SLIMMED -- bridge-only, depends on app-host
packages/ui/             EXTENDED -- ProjectPickerDialog added
apps/sim/                UPDATED -- uses ProjectManager, project-scoped brains
```

### Object hierarchy (post-refactor)

```
SimEnvironmentStore              (sole top-level singleton -- unchanged role)
  |
  +-- ProjectManager             (from app-host)
  |     +-- ProjectStore         (localStorage CRUD, key prefix from host app)
  |     +-- activeProject
  |           +-- manifest       (id, name, timestamps)
  |           +-- workspace      (LocalStorageWorkspace, project-scoped key)
  |
  +-- MindcraftEnvironment       (from core -- persists across project switches)
  |
  +-- AppBridge                  (from bridge-app -- optional)
  |     +-- BridgeProject        (wraps active workspace for sync)
  |
  +-- Global app settings        (not per-project)
  +-- Per-project UI prefs       (managed by sim, stored separately from project)
```

### localStorage key scheme

All keys prefixed with the host app's package name (read from package.json at
build time or passed as a config string):

```
@mindcraft-lang/sim:project-index            -> ProjectManifest[]
@mindcraft-lang/sim:project:{id}:workspace   -> WorkspaceSnapshot
@mindcraft-lang/sim:project:{id}:app:{key}   -> opaque app data blob
@mindcraft-lang/sim:active-project           -> id of last-opened project
@mindcraft-lang/sim:app-settings             -> global app settings
@mindcraft-lang/sim:project-ui:{id}          -> per-project UI prefs (not portable)
```

### Project switch sequence

```
switchProject(id)
  1. auto-save current project (brains + workspace already debounce-persisted)
  2. projectManager.open(id)
       -> swaps LocalStorageWorkspace to new project's storage key
  3. load brains from projectManager.loadAppData(id, "brains")
       -> inject into MindcraftEnvironment (replace all actor brains)
  4. if bridge connected:
       -> workspace emits "import" change (full file tree replacement)
       -> bridge forwards to extension seamlessly
```

### Auto-save triggers

No explicit save. Two auto-save paths:

- Workspace file changes: LocalStorageWorkspace debounced persistence (existing
  mechanism, now scoped to project key)
- Brain edit / recompile: SimEnvironmentStore calls
  projectManager.saveAppData(id, "brains", ...) whenever brains change

### Key design decisions

- No backward compatibility. Old localStorage data is abandoned.
- No project import/export in V1.
- No thumbnails in V1.
- Brains are app-specific data, not shared across apps or projects.
- Per-project UI preferences (timeScale, debugEnabled, etc.) are stored
  separately from the project and are not portable.
- Global app settings (bridge URL, etc.) are not per-project.
- Bridge seamlessly re-syncs on project switch via workspace "import" change.
- Project creation uses a separate dialog (in sim, not ui), prefilled name.
- ProjectPickerDialog handles deletion confirmation inline.
- Rename active project by clicking its title in the header (same interaction
  as brain rename).
- Hamburger menu in upper-left: New Project, Browse Projects.

---

## Phase P1: Create `packages/app-host` -- Types and ProjectStore

**Goal**: Stand up the new package with the core data model and localStorage
storage layer. No code moves yet.

### Deliverables

1. **Package scaffolding**: `packages/app-host/` with package.json, tsconfig.json,
   biome.json, README.md. Package name: `@mindcraft-lang/app-host`. No
   dependencies on other workspace packages.

2. **`ProjectManifest` type** in `src/project-manifest.ts`:
   ```ts
   interface ProjectManifest {
     id: string;           // crypto.randomUUID()
     name: string;
     createdAt: number;    // Date.now()
     updatedAt: number;
   }
   ```

3. **`ProjectStore` interface** in `src/project-store.ts`:
   ```ts
   interface ProjectStore {
     listProjects(): ProjectManifest[];
     getProject(id: string): ProjectManifest | undefined;
     createProject(name: string): ProjectManifest;
     deleteProject(id: string): void;
     updateProject(id: string, updates: Partial<Pick<ProjectManifest, "name">>): void;
     duplicateProject(id: string, newName: string): ProjectManifest;

     loadWorkspace(id: string): WorkspaceSnapshot | undefined;
     saveWorkspace(id: string, snapshot: WorkspaceSnapshot): void;

     loadAppData(id: string, key: string): string | undefined;
     saveAppData(id: string, key: string, data: string): void;
     deleteAppData(id: string, key: string): void;

     getActiveProjectId(): string | undefined;
     setActiveProjectId(id: string | undefined): void;
   }
   ```
   `WorkspaceSnapshot` is `Map<string, WorkspaceEntry>` (same shape as current
   LocalStorageWorkspace). Define it locally in app-host rather than importing
   from bridge-app.

4. **`LocalStorageProjectStore`** in `src/local-storage-project-store.ts`:
   Implements `ProjectStore` using localStorage with the key scheme above.
   Constructor takes `keyPrefix: string` (e.g. `"@mindcraft-lang/sim"`).

5. **`src/index.ts`** barrel export.

### Files touched

- `packages/app-host/` (new directory, all files new)
- `packages/package.json` (add workspace reference if needed)
- Root `tsconfig.json` (add project reference if needed)

### Risks

- `WorkspaceSnapshot` type needs to match what LocalStorageWorkspace produces.
  Define it independently in app-host; alignment verified in P2 when the move
  happens.

---

## Phase P2: Move Workspace Primitives to `app-host`

**Goal**: Move `WorkspaceAdapter`, `LocalStorageWorkspace`, `MindcraftJson`, and
`ExampleDefinition` types from bridge-app to app-host. bridge-app re-exports
from app-host for backward compatibility during the transition.

### Deliverables

1. **Move to `packages/app-host/src/`**:
   - `workspace-adapter.ts` (the `WorkspaceAdapter` interface and
     `WorkspaceChange` / `WorkspaceSnapshot` types)
   - `local-storage-workspace.ts` (the `LocalStorageWorkspace` class)
   - `mindcraft-json.ts` (`MindcraftJson` type, parse/serialize, path constant)
   - `examples.ts` (`ExampleDefinition`, `ExampleFile` types, `EXAMPLES_FOLDER`
     constant)

2. **bridge-app depends on app-host**: Add `@mindcraft-lang/app-host` as a
   dependency in bridge-app's package.json.

3. **bridge-app re-exports**: Update bridge-app's `index.ts` to re-export these
   symbols from `@mindcraft-lang/app-host` so existing consumers (apps/sim)
   continue to compile without changes.

4. **Reconcile `WorkspaceSnapshot`**: If the type defined in P1 diverges from
   what was moved, unify to a single definition. The moved code is canonical.

5. **Verify**: `npm run typecheck` and `npm run check` pass in both
   `packages/app-host` and `packages/bridge-app`. apps/sim still compiles.

### Files touched

- `packages/app-host/src/` (new/moved files)
- `packages/app-host/package.json` (no new deps expected)
- `packages/bridge-app/src/` (delete originals, update imports)
- `packages/bridge-app/src/index.ts` (re-exports)
- `packages/bridge-app/package.json` (add app-host dep)

### Prerequisites

- Phase P1

### Risks

- bridge-app's internal imports reference the moved files. All internal imports
  must be updated to point at app-host or the local re-exports.
- `LocalStorageWorkspace` may have implicit dependencies on bridge-protocol
  types. If so, either extract the protocol-independent parts or add
  bridge-protocol as an app-host dependency (less desirable).

---

## Phase P3: ProjectManager

**Goal**: Add the `ProjectManager` class to app-host. This is the primary API
for apps to manage projects -- create, open, switch, list, delete, duplicate.

### Deliverables

1. **`ProjectManager`** in `src/project-manager.ts`:
   ```ts
   class ProjectManager {
     constructor(store: ProjectStore);

     readonly projects: ProjectManifest[];
     readonly activeProject: ActiveProject | undefined;

     create(name: string): ProjectManifest;
     open(id: string): ActiveProject;
     close(): void;
     delete(id: string): void;
     duplicate(id: string, newName: string): ProjectManifest;
     renameActive(newName: string): void;

     onActiveProjectChange(listener: (project: ActiveProject | undefined) => void): () => void;
     onProjectListChange(listener: (projects: ProjectManifest[]) => void): () => void;
   }

   interface ActiveProject {
     manifest: ProjectManifest;
     workspace: LocalStorageWorkspace;
   }
   ```

2. **Lifecycle behavior**:
   - `open(id)`: Saves current project's workspace snapshot, then loads the
     target project's workspace from the store. Creates a new
     `LocalStorageWorkspace` scoped to the project's storage key.
   - `create(name)`: Creates manifest via store, then opens the new project.
   - `delete(id)`: Cannot delete the active project. Removes manifest and all
     associated data from the store.
   - `close()`: Saves active project, clears active state.
   - On construction, if store has an `activeProjectId`, auto-open that project.

3. **Auto-save coordination**: The workspace's debounced persistence writes to
   the project-scoped key automatically. `ProjectManager.saveAppData()` is a
   pass-through to the store for app-specific blobs (brains, etc.).

4. **First-launch helper**: `ensureDefaultProject(defaultName: string)` -- if
   no projects exist, creates and opens one with the given name. Apps call this
   at startup.

5. **Export from `src/index.ts`**.

### Files touched

- `packages/app-host/src/project-manager.ts` (new)
- `packages/app-host/src/index.ts` (add exports)

### Prerequisites

- Phase P2 (LocalStorageWorkspace available in app-host)

### Risks

- Workspace lifecycle during switch: old workspace must flush pending writes
  before the new one is created. Verify debounce flush on close.

---

## Phase P4: Refactor bridge-app -- BridgeProject

**Goal**: Rename `AppProject` to `BridgeProject`, rename `createAppProject` to
`createBridgeProject`. The bridge accepts a `WorkspaceAdapter` from the caller
(provided by ProjectManager's active project workspace) rather than creating its
own.

### Deliverables

1. **Rename** `AppProject` -> `BridgeProject` in
   `packages/bridge-app/src/app-project.ts` (rename file to
   `bridge-project.ts`).

2. **Rename** `createAppProject` -> `createBridgeProject` in
   `packages/bridge-app/src/compilation.ts`.

3. **`createBridgeProject` accepts a `WorkspaceAdapter`** from the caller instead
   of creating a `LocalStorageWorkspace` internally. The function still augments
   the workspace with compiler-controlled files and examples, but the underlying
   storage is owned by the caller (ProjectManager).

4. **Update `createAppBridge`** if needed -- it may need to accept the workspace
   from the caller as well.

5. **Update all consumers**: apps/sim imports updated to new names.

6. **Verify**: `npm run typecheck` and `npm run check` in bridge-app, app-host,
   and apps/sim.

### Files touched

- `packages/bridge-app/src/app-project.ts` -> `bridge-project.ts` (rename + update)
- `packages/bridge-app/src/compilation.ts` (rename function)
- `packages/bridge-app/src/app-bridge.ts` (accept workspace from caller)
- `packages/bridge-app/src/index.ts` (update exports)
- `apps/sim/src/services/sim-environment-store.ts` (update imports/calls)

### Prerequisites

- Phase P2 (bridge-app depends on app-host)

### Risks

- `createAppProject` currently creates the workspace, compiler, and wires
  compilation features in one call. Splitting workspace ownership out may
  require restructuring its parameters. Keep the function's role as "set up
  compilation for a workspace" but remove storage ownership.

---

## Phase P5: ProjectPickerDialog in `packages/ui`

**Goal**: Add a reusable project picker dialog component to the shared UI
package.

### Deliverables

1. **`ProjectPickerItem` type**:
   ```ts
   interface ProjectPickerItem {
     id: string;
     title: string;
     description?: string;
     tags?: string[];
     updatedAt: number;
   }
   ```

2. **`ProjectPickerDialog` component** in
   `packages/ui/src/project-picker/project-picker-dialog.tsx`:
   - Props:
     ```ts
     interface ProjectPickerDialogProps {
       open: boolean;
       onOpenChange: (open: boolean) => void;
       projects: ProjectPickerItem[];
       activeProjectId?: string;
       onSelect: (id: string) => void;
       onDelete: (id: string) => void;
       onCreate: () => void;
     }
     ```
   - Displays a scrollable list of projects sorted by `updatedAt` (most recent
     first).
   - Each item shows title, description (if present), tags (if present), and a
     relative timestamp ("2 hours ago", "yesterday").
   - Active project is visually highlighted.
   - Delete button per item with inline confirmation ("Are you sure? Yes / Cancel").
   - "New Project" button triggers `onCreate`.
   - Clicking a project triggers `onSelect` and closes the dialog.
   - Uses existing shadcn/ui primitives (Dialog, Button, etc.) from the ui
     package.

3. **Export from `packages/ui/src/index.ts`**.

### Files touched

- `packages/ui/src/project-picker/` (new directory)
- `packages/ui/src/project-picker/project-picker-dialog.tsx` (new)
- `packages/ui/src/index.ts` (add export)

### Prerequisites

- None (pure UI, no dependency on app-host types)

### Risks

- Styling must work in any consuming app's Tailwind setup. Use only the
  existing design tokens and utility classes already established in the ui
  package.

---

## Phase P6: Sim State Integration

**Goal**: Wire ProjectManager into SimEnvironmentStore. Replace flat brain
persistence with project-scoped storage. Implement project auto-save.

### Deliverables

1. **SimEnvironmentStore owns a `ProjectManager`**:
   - Constructed with `new ProjectManager(new LocalStorageProjectStore("@mindcraft-lang/sim"))`.
   - On initialization, calls `projectManager.ensureDefaultProject("Untitled Project")`.
   - No other new top-level singletons.

2. **Project-scoped brain persistence**:
   - Remove `brain-persistence.ts` functions that use flat
     `brain-archetype-{name}` keys.
   - Replace with `projectManager.saveAppData(id, "brains", serializedBrains)`
     and `projectManager.loadAppData(id, "brains")`.
   - Brain data format: JSON string of `Record<archetypeName, serializedBrainDef>`.

3. **Auto-save on brain change**: Wherever `saveBrainToLocalStorage` was called,
   call the project-scoped equivalent. Debounce if needed (brain edits can be
   rapid).

4. **Project switch wiring**:
   - `switchProject(id)` method on SimEnvironmentStore.
   - Saves current brains, opens new project, loads new brains into
     MindcraftEnvironment, replaces all actor brain instances.
   - If bridge is connected, the workspace "import" change propagates
     automatically.

5. **Per-project UI preferences**:
   - Read/write to `@mindcraft-lang/sim:project-ui:{id}` via localStorage
     directly (not through ProjectStore -- these are non-portable).
   - Swap preferences when switching projects.

6. **Remove old localStorage keys**: Delete references to `brain-archetype-*`,
   `sim:vscode-bridge:filesystem`, `ui-preferences` (replaced by per-project).
   Keep `app-settings` (global).

7. **Verify**: `npm run typecheck` and `npm run check` in apps/sim.

### Files touched

- `apps/sim/src/services/sim-environment-store.ts` (major changes)
- `apps/sim/src/services/brain-persistence.ts` (rewrite or delete)
- `apps/sim/src/brain/actor.ts` (if brain loading path changes)

### Prerequisites

- Phase P3 (ProjectManager exists)
- Phase P4 (bridge accepts external workspace)

### Risks

- Brain serialization format must survive the transition. Since there's no
  backward compat requirement, this is a clean break -- but verify the
  serialize/deserialize round-trip works with the new storage path.
- Actor brain replacement on project switch must handle in-progress simulation
  gracefully. Consider pausing the sim during switch.

---

## Phase P7: Sim UI -- Hamburger Menu and Project Picker

**Goal**: Add the project management UI to the sim app.

### Deliverables

1. **Hamburger menu** in the upper-left corner of the sim UI:
   - Menu items: "New Project", "Browse Projects".
   - Uses existing DropdownMenu primitive from packages/ui.

2. **Active project name** displayed in the header, to the right of the hamburger
   icon. Clicking the name enters inline edit mode (same interaction model as
   brain rename). On blur or Enter, calls `projectManager.renameActive(newName)`.

3. **"Browse Projects"** opens the `ProjectPickerDialog` from packages/ui.
   - Maps `ProjectManifest[]` -> `ProjectPickerItem[]` at the call site.
   - `onSelect` triggers `switchProject(id)`.
   - `onDelete` triggers `projectManager.delete(id)` (dialog handles
     confirmation).
   - `onCreate` triggers the New Project flow.

4. **"New Project" dialog** (in apps/sim, not packages/ui):
   - Simple dialog with a single text input for project name.
   - Prefilled with a generated default name ("Project 2", "Project 3", etc.,
     based on existing project count).
   - On confirm, calls `projectManager.create(name)` which creates and opens
     the new project.

5. **First-launch behavior**: On first launch (no projects exist),
   `ensureDefaultProject` has already created "Untitled Project" in P6. The user sees
   the sim with "Untitled Project" in the header. No dialog on first launch.

6. **Verify**: Full manual test of create, open, switch, delete, rename flows.

### Files touched

- `apps/sim/src/components/` (new hamburger menu component, new project dialog)
- `apps/sim/src/components/Sidebar.tsx` or equivalent (header area)
- `apps/sim/src/App.tsx` (wire dialogs)

### Prerequisites

- Phase P5 (ProjectPickerDialog exists)
- Phase P6 (SimEnvironmentStore has ProjectManager)

### Risks

- Layout changes to accommodate the hamburger menu and project name. May need
  to adjust existing header/toolbar layout.
- Inline rename interaction must handle edge cases: empty name (reject), very
  long name (truncate display), Escape to cancel.

---

## Phase Log

### Phase P1 (2026-04-18)

- All deliverables landed as specified.
- `WorkspaceSnapshot` types defined independently in `workspace-snapshot.ts`,
  structurally compatible with bridge-client's `ExportedFileSystem`.
- Package has zero workspace dependencies.
- No deviations from spec.

**New risks for P2:**
- `LocalStorageWorkspace` in bridge-app uses `window.setTimeout` and
  `window.clearTimeout` directly. When moved to app-host, this constrains
  the package to browser-only. Acceptable for now but worth noting.
- `WorkspaceChange` (alias for `FileSystemNotification` from bridge-protocol)
  is a Zod-inferred type with 6 action variants. Moving `LocalStorageWorkspace`
  requires either (a) redefining this type in app-host independently, or
  (b) adding bridge-protocol as a dependency. Option (a) preferred to keep
  app-host dependency-free, but the type surface is larger than
  `WorkspaceSnapshot` -- plan for this.
- `LocalStorageWorkspace.applyRemoteChange` and `onLocalChange` both use
  `WorkspaceChange` (which is `FileSystemNotification`). The
  `WorkspaceAdapter` interface itself references these types. All three
  (`WorkspaceAdapter`, `WorkspaceChange`, `LocalStorageWorkspace`) must move
  together.

P2 risks resolved: `WorkspaceChange` redefined independently in app-host,
all three types moved together successfully.

### Phase P2 (2026-04-18)

- All deliverables landed as specified.
- `WorkspaceChange` redefined as independent 6-variant discriminated union
  in `workspace-snapshot.ts`. Structurally compatible with bridge-protocol's
  `FileSystemNotification`.
- Removed duplicate `WorkspaceAdapter` interface from `app-bridge.ts` (was
  both imported and locally defined -- caused TS2440/TS2484 conflict).
- bridge-app must be built (`npm run build`) before consumers can resolve
  `@mindcraft-lang/app-host` through its re-exports. This is normal for
  composite project references but worth noting for build ordering.
- No new risks for P3.

### Phase P3 (2026-04-18)

- All spec deliverables landed: `ProjectManager` class, `ActiveProject`
  interface, `ensureDefaultProject`, app-data pass-throughs, event listeners.

**Deviations from spec:**
- Added `flush()` to `WorkspaceAdapter` interface (not in spec). Required to
  solve the spec-identified risk "old workspace must flush pending writes
  before the new one is created." Implemented in `LocalStorageWorkspaceStore`,
  `augmentWorkspace` wrapper (compilation.ts), and `MemoryWorkspace` (test).
- Added `saveAppData`/`loadAppData`/`deleteAppData` pass-throughs on
  `ProjectManager` (spec mentioned `saveAppData` briefly but didn't list the
  full trio in the interface sketch).
- Constructor accepts optional `workspaceOptions` (sans `storageKey`) to
  forward debounce settings to workspaces. Not in spec.
- Workspace storageKey uses `project:{id}:workspace-live` (distinct from the
  store's snapshot key) to separate debounced live writes from explicit saves.

**Risks resolved:**
- Debounce flush on close: solved via `flush()` on `WorkspaceAdapter`.

**New risks for P4:**
- `flush()` added to `WorkspaceAdapter` means any future implementor must
  provide it. Existing consumers (bridge-app tests, augmentWorkspace) updated.
- `openInternal` creates a fresh `LocalStorageWorkspace` each time a project
  is opened. If the live storageKey already has stale data from a previous
  session, the `import` call overwrites it. This is correct behavior but worth
  verifying in integration.

### Phase P4 (2026-04-18)

- All renames landed via semantic rename tool (5 symbols, propagated to all
  consumers including apps/sim).
- File renamed: `app-project.ts` -> `bridge-project.ts`.
- Updated `bridge-app.instructions.md` and `INTEGRATION.md` to reflect new names.

**Deviations from spec:**
- Deliverable #3 (accept `WorkspaceAdapter` from caller) was already the case --
  `createAppProject` already accepted `workspace: WorkspaceAdapter`. No code
  change needed.
- Deliverable #6 (backward compat aliases) removed per user preference (clean
  break, sole consumer updated in same phase).

**Risks resolved:**
- Spec risk ("splitting workspace ownership may require restructuring
  parameters") was a non-issue -- workspace was already externally owned.

**New risks for P5:**
- bridge-app must be rebuilt (`npm run build`) before sim can resolve renamed
  exports via subpath `@mindcraft-lang/bridge-app/compilation`. Normal for
  composite project references but easy to forget during development.

### Phase P5 (2026-04-18)

- `ProjectPickerDialog` component created in `packages/ui/src/project-picker/`.
- Exported from `packages/ui/src/index.ts` via barrel.

**Deviations from spec:**
- File named `ProjectPickerDialog.tsx` (PascalCase) instead of spec's
  `project-picker-dialog.tsx`, matching the dominant convention for React
  components in the ui package.
- Biome a11y lints required using `<button>` instead of `<div role="button">`
  for project items, and `role="none"` on the inner event-stopping wrapper.

### Phase P6 (2026-04-18)

- SimEnvironmentStore now owns a `ProjectManager`. Brain persistence moved
  from flat `brain-archetype-*` localStorage keys to project-scoped
  `saveAppData("brains", ...)`. Project switching, per-project UI prefs,
  and `initialize()` lifecycle all landed.

**Deviations from spec:**
- Deliverable #1: Constructor uses `createLocalStorageProjectStore(simName)`
  with `simName` imported from `package.json`, not a hard-coded string.
  Default project name is "Untitled Project" (spec said same).
- Deliverable #2: `brain-persistence.ts` was trimmed rather than deleted --
  `deserializeBrainFromArrayBuffer` is still needed by the Preloader scene
  for drag-and-drop `.brain` file import.
- Deliverable #6 (remove old localStorage keys): Not done. Old keys are
  no longer written, but no migration or cleanup of stale keys was added.
  This is harmless -- stale keys are ignored -- but worth noting for P7 or
  a future housekeeping pass.
- `loadBrainFromProject` casts `IBrainDef` return from
  `deserializeBrainJsonFromPlain` to `BrainDef` (concrete class). This
  mirrors the old `instanceof` guard pattern. If the core API is ever
  changed to return a different implementation, this cast would silently
  succeed but could break at runtime.

**Files touched (beyond spec prediction):**
- `apps/sim/src/App.tsx` -- updated brain save call site.
- `apps/sim/src/brain/engine.ts` -- updated brain load call site, removed
  debug logging.
- `apps/sim/src/services/index.ts` -- trimmed re-exports.
- `apps/sim/package.json` -- added `@mindcraft-lang/app-host` dependency.
- `apps/sim/tsconfig.refs.json` -- added app-host project reference.

**Risks for P7:**
- `switchProject` replaces the compiler workspace snapshot but does not
  pause the simulation. Rapid switching could cause a frame to read stale
  brain data. P7's UI should debounce or gate switches.
- `updateUiPreferences` silently skips persistence if no active project
  (guard added for safety). This should never happen in practice but means
  prefs edits before `initialize()` are lost.

**No new risks for P6.**

### Phase P7 (2026-04-18)

- Hamburger menu (DropdownMenu), inline-editable project name, ProjectPickerDialog
  wiring, and NewProjectDialog all landed.

**Deviations from spec:**
- Spec predicted touching `Sidebar.tsx` for header area changes. Instead,
  `ProjectHeader` is a new standalone component positioned absolutely over the
  game canvas in `<main>`, avoiding any sidebar layout changes.
- Spec deliverable #6 (full manual test) not performed by the implementer --
  left to the user.
- P6 risk "rapid switching could read stale brain data" was not addressed with
  debounce or gating in P7. The UI triggers `switchProject` synchronously on
  picker select. In practice the risk is low (switching is user-initiated and
  infrequent) but remains open.

**Files created:**
- `apps/sim/src/components/ProjectHeader.tsx`
- `apps/sim/src/components/NewProjectDialog.tsx`

**Files modified:**
- `apps/sim/src/App.tsx` -- project state, event subscriptions, dialog wiring,
  ProjectHeader in layout.

