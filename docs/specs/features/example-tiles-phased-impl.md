# Example Tiles -- Phased Implementation Plan

Companion to the design discussion in the conversation that preceded this doc.

---

## Workflow Convention

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

- (2026-04-16) Phase E7 complete. Sim example loader, injection call,
  tsconfig exclusion, and syntax-only editor checking for example files.

---

## Overview

Apps (e.g. apps/sim) ship example tiles -- sensor and actuator source files with
accompanying documentation and icons. These examples are synced into the VS Code
extension's virtual filesystem under a hidden `__examples__` folder, displayed in
the Mindcraft Explorer panel, and openable as read-only files. Users can copy an
entire example into their workspace via multiple affordances.

### Data flow

```
App startup
  -> import.meta.glob loads example .ts/.md/.svg as raw strings
  -> bridge-app injectExamples([{ folder, files }])
  -> augmentWorkspace merges into __examples__/<folder>/<file>
  -> syncs to extension via bridge
  -> extension VFS hides __examples__ from mindcraft:// directory listing
  -> Explorer tree reads __examples__/ to build Examples subtree
  -> files open via mindcraft-example:// scheme (read-only, copy affordances)
```

### Key design decisions

- Hidden folder name: `__examples__`
- Example .ts files excluded from workspace compilation
- Examples are read-only in the extension
- Separate `mindcraft-example` URI scheme for copy-to-workspace affordances
- Copy imports the full example subfolder to workspace root (uniqueified name)
- App provides folder name; no sensor/actuator distinction; alphabetical sort
- Scale: 5-10 examples max; full sync on reconnect is acceptable
- App loads example content via `import.meta.glob` with `?raw` query (eager)

---

## Phase E1: bridge-app Example Injection API

**Goal**: Add the API surface in bridge-app that lets any app inject example files
into the workspace snapshot.

### Deliverables

1. **`ExampleDefinition` type** in `packages/bridge-app/src/examples.ts`:
   ```ts
   interface ExampleFile {
     path: string;    // e.g. "teleport.ts"
     content: string; // raw file content
   }
   interface ExampleDefinition {
     folder: string;  // e.g. "Teleport"
     files: ExampleFile[];
   }
   ```

2. **`injectExamples(examples: ExampleDefinition[])` method** on `AppProjectHandle`
   (returned by `createAppProject`). Stores the examples so that
   `augmentWorkspace.exportSnapshot()` includes them under
   `__examples__/<folder>/<path>`, marked readonly.

3. **`EXAMPLES_FOLDER` constant** (`"__examples__"`) exported from bridge-app for
   shared use.

4. **Unit/integration consideration**: No new test files required. The method is
   fire-and-forget; correctness is verified in later phases via the extension.

### Files touched

- `packages/bridge-app/src/examples.ts` (new)
- `packages/bridge-app/src/compilation.ts` (augmentWorkspace reads injected examples)
- `packages/bridge-app/src/index.ts` (re-export)

### Risks

- `augmentWorkspace` currently only reads compiler-controlled files. Adding another
  source of injected files requires either a shared store or a callback pattern.
  Prefer a simple mutable array held by the `createAppProject` closure.

---

## Phase E2: Compiler Exclusion

**Goal**: Ensure the workspace compiler excludes `__examples__/**` from compilation.

### Deliverables

1. **ts-compiler exclusion**: The generated `tsconfig.json` (or the workspace
   compiler's file filtering) excludes paths starting with `__examples__/` from
   the compilation unit.

2. **Verify**: Example .ts files present in the VFS do not produce diagnostics
   and are not included in the compilation file set.

### Files touched

- `packages/ts-compiler/src/workspace-compiler.ts` (or wherever tsconfig is
  generated / file list is built)
- `packages/ts-compiler/src/compiler/ambient.ts` (if tsconfig exclude is
  generated there)

### Prerequisites

- Phase E1 (examples in the snapshot)

### Risks

- The compiler may enumerate files from the filesystem directly. Need to confirm
  the file-discovery path and add the filter there rather than only in tsconfig.

---

## Phase E3: Extension VFS Filtering & Example Scheme

**Goal**: Hide `__examples__` from the workspace folder listing and create the
`mindcraft-example` URI scheme.

### Deliverables

1. **Filter `__examples__`** from `MindcraftFileSystemProvider.readDirectory()`
   when listing the workspace root. The folder and its contents remain accessible
   via direct path for internal use.

2. **New `MindcraftExampleFileSystemProvider`** implementing
   `vscode.FileSystemProvider` (read-only). Registered for scheme
   `mindcraft-example`. Reads from the same underlying filesystem but resolves
   paths under `__examples__/`. For example, `mindcraft-example:///Teleport/teleport.ts`
   reads from filesystem path `__examples__/Teleport/teleport.ts`. All files are
   `Readonly` permission.

3. **Scheme registration** in `extension.ts` activate function.

### Files touched

- `apps/vscode-extension/src/services/mindcraft-fs-provider.ts` (filter)
- `apps/vscode-extension/src/services/mindcraft-example-fs-provider.ts` (new)
- `apps/vscode-extension/src/extension.ts` (register scheme)
- `apps/vscode-extension/package.json` (if scheme needs declaration)

### Prerequisites

- Phase E1 (examples exist in VFS)

### Risks

- VS Code may require the scheme in `package.json` `contributes` for some
  features (e.g., file decorations). Test early.

---

## Phase E4: Explorer Tree -- Examples Folder

**Goal**: Add the Examples folder and its children to the Mindcraft Explorer panel.

### Deliverables

1. **Extend `MindcraftSessionsProvider`** to support collapsible tree items:
   - Top-level "Examples" item (collapsible, folder icon) -- shown only when
     connected and examples exist in the VFS.
   - Second level: one item per example subfolder (e.g. "Teleport") -- collapsible.
   - Third level: file entries from the subfolder + a "Copy to Workspace" action
     item.

2. **File tree items** open the file in an editor via `mindcraft-example://` URI
   when clicked.

3. **Example folder click behavior**: When an example subfolder item is selected
   (expanded or clicked), open the example's `.md` file in VS Code's built-in
   markdown preview (`markdown.showPreview`).

4. **"Copy to Workspace" tree item** triggers the `mindcraft.copyExampleToWorkspace`
   command with the example folder name as argument.

4. **Refresh**: Tree refreshes when the filesystem changes (examples injected
   after reconnect).

### Files touched

- `apps/vscode-extension/src/views/mindcraft-sessions-provider.ts`
- `apps/vscode-extension/package.json` (tree view configuration if needed)

### Prerequisites

- Phase E3 (example scheme exists)

---

## Phase E5: Copy-to-Workspace Command

**Goal**: Implement the command that copies an example's folder into the user's
workspace.

### Deliverables

1. **`mindcraft.copyExampleToWorkspace` command**: Accepts `string | Uri | undefined`
   and branches based on context:
   - `string` -- example folder name (from tree item or CodeLens).
   - `Uri` -- a `mindcraft-example://` URI (from editor/title button); extract
     the example folder name from the first path segment.
   - `undefined` -- invoked from command palette with no context; show a
     quick-pick listing available examples.
   
   Behavior:
   - Reads all files from `__examples__/<folder>/` in the VFS.
   - Determines a unique target folder name at the workspace root (e.g.
     `Teleport`, `Teleport-2`, `Teleport-3`).
   - Creates the folder and writes all files via the `mindcraft://` write FS
     (which triggers bridge sync back to the app).
   - Shows an info notification on success: "Copied example 'Teleport' to
     workspace."
   - **Post-copy**: Opens the main `.ts` file in the editor. The main file is
     identified by matching the folder name (case-insensitive). For example,
     folder `Teleport` -> opens `teleport.ts`. An example may contain multiple
     `.ts` files; never assume there is only one.

2. **Uniqueification logic**: Check existing top-level folders in `mindcraft://`
   and append `-N` suffix if name collision.

### Files touched

- `apps/vscode-extension/src/commands/index.ts` (or new
  `commands/copy-example.ts`)
- `apps/vscode-extension/package.json` (command contribution)

### Prerequisites

- Phase E3 (example scheme for reading), Phase E4 (tree triggers the command)

### Risks

- Writing multiple files in sequence could trigger multiple filesystem change
  events. Consider batching or suppressing intermediate refreshes.

---

## Phase E6: CodeLens, Editor Title & Tab Decorations

**Goal**: Add copy-to-workspace affordances when viewing example files and
visually distinguish example tabs from workspace tabs.

### Deliverables

1. **CodeLens provider** registered for `mindcraft-example` scheme. Returns a
   single lens at line 0, column 0 with title "Copy to Workspace" that triggers
   `mindcraft.copyExampleToWorkspace` with the example folder name extracted
   from the URI path.

2. **Editor/title command**: Register `mindcraft.copyExampleToWorkspace` in
   `package.json` `contributes.menus` under `editor/title` with a `when` clause
   scoped to `resourceScheme == mindcraft-example`. Displays a button (e.g.
   cloud-download icon) in the editor title bar.

3. Both affordances apply to any file type opened from the example scheme
   (.ts, .md, .svg).

4. **`FileDecorationProvider`** for the `mindcraft-example` scheme. Applies a
   badge and/or color to example file tabs so they are visually distinct from
   workspace files. VS Code's `FileDecoration` supports `badge` (short string,
   max 2 chars) and `color` (ThemeColor). Use a badge like "Ex" and a distinct
   `ThemeColor` (e.g. `charts.purple` or a custom color from the extension's
   color contributions). This lets users immediately see that an open tab is
   an example, not an editable workspace file.

### Files touched

- `apps/vscode-extension/src/providers/example-codelens-provider.ts` (new)
- `apps/vscode-extension/src/providers/example-decoration-provider.ts` (new)
- `apps/vscode-extension/src/extension.ts` (register CodeLens + decoration providers)
- `apps/vscode-extension/package.json` (menus, commands, color contributions if needed)

### Prerequisites

- Phase E5 (copy command exists)

---

## Phase E7: Sim Example Assets & Integration

**Goal**: Create the actual example content in apps/sim and wire up injection.

### Deliverables

1. **Example assets** under `apps/sim/src/examples/`:
   ```
   src/examples/
     Teleport/
       teleport.ts
       teleport.md
       teleport.svg
     Hear/
       hear.ts
       hear.md
       hear.svg
   ```
   (Actual example set TBD by the user. Phase delivers the loading infrastructure
   and at least one placeholder example for testing.)

2. **Loader module** `apps/sim/src/examples/index.ts`:
   - Uses `import.meta.glob('./\*\*/\*', { query: '?raw', import: 'default', eager: true })`
     to load all example files as raw strings.
   - Transforms the glob result into `ExampleDefinition[]` by parsing paths.

3. **Injection call**: In the sim's startup flow (sim-environment-store.ts or
   wherever `createAppProject` is called), invoke
   `project.injectExamples(loadExamples())` after project creation.

4. **tsconfig.json exclusion**: Add `"exclude": ["src/examples"]` to
   `apps/sim/tsconfig.json` so the sim build does not type-check example .ts
   files.

### Files touched

- `apps/sim/src/examples/` (new directory with example assets)
- `apps/sim/src/examples/index.ts` (new loader)
- `apps/sim/src/services/sim-environment-store.ts` (injection call)
- `apps/sim/tsconfig.json` (exclude)

### Prerequisites

- Phase E1 (bridge-app API)

### Risks

- `import.meta.glob` with `?raw` may need Vite configuration for .svg files.
  Test that SVG content is returned as a string, not processed by the SVG
  plugin.

---

## Phase Log

### Phase E1 (2026-04-16)

- All deliverables landed as specified.
- `injectExamples` stores examples in a mutable array in the `createAppProject`
  closure. `augmentWorkspace` reads via `getExamples()` callback.
- Example files use etag `"example"` and `isReadonly: true`.
- Directory entries created for each example subfolder.
- No deviations or new risks.

### Phase E2 (2026-04-16)

- Added `isExamplePath()` in `packages/ts-compiler/src/compiler/project.ts`.
- Filter added alongside `isCompilerControlledPath` in `_compile()` loop.
- Kept `isCompilerControlledPath` semantically pure (not polluted with example logic).
- No deviations.

### Phase E3 (2026-04-16)

- All deliverables landed as specified.
- `MindcraftExampleFileSystemProvider` created as read-only FS provider for
  `mindcraft-example` scheme. Maps URI paths under `__examples__/` in the
  underlying VFS.
- `readDirectory()` in `MindcraftFileSystemProvider` filters `__examples__`
  at root level only.
- `ProjectManager` wires the example provider on connect/disconnect and
  closes example-scheme tabs on disconnect.
- `extension.ts` registers the scheme with `isReadonly: true`.
- No deviations or new risks.

### Phase E4 (2026-04-16)

- Hierarchical tree: ExamplesFolderItem -> ExampleGroupItem -> ExampleFileItem + ExampleCopyItem.
- ExampleGroupItem click opens `.md` via `markdown.showPreview`.
- ExampleFileItem uses `resourceUri` for auto file icon inference.
- Tree refreshes on `fsProvider.onDidChangeFile` to catch post-sync example arrival.
- Convention: .md filename matches folder name lowercased.
- No deviations.

### Phase E5 (2026-04-16)

- `mindcraft.copyExampleToWorkspace` command: `string | Uri | undefined` arg.
- `resolveExampleFolder()` handles all three arg types; quick-pick for palette.
- `findUniqueFolderName()` appends `-N` suffix on collision.
- Post-copy opens main `.ts` (folder name match, case-insensitive).
- Reads from `files.raw`, writes via `files.toRemote` (triggers bridge sync).
- No deviations.

### Phase E6 (2026-04-16)

- `ExampleCodeLensProvider`: single "Copy to Workspace" lens at line 0 for `mindcraft-example` scheme.
- `ExampleDecorationProvider`: "Ex" badge with `charts.purple` ThemeColor on example tabs.
- Editor/title button via `package.json` menus with `when: resourceScheme == mindcraft-example`.
- Both providers registered in `extension.ts`.
- Files placed in `src/providers/` (new directory) rather than spec's `src/providers/` -- matches.
- No deviations.

### Phase E7 (2026-04-16)

- Loader: `src/examples/index.ts` uses `import.meta.glob('./**/*', { query: '?raw', eager: true })`.
- Regex `^\.\/([^/]+)\/(.+)$` naturally skips `index.ts` (no subfolder segment).
- Injection: `project.injectExamples(loadExamples())` between `createAppProject()` and `initialize()`.
- tsconfig exclusion: `"exclude": ["src/examples/*/**"]` excludes subfolder contents, keeps loader.
- Extra: `src/examples/tsconfig.json` with `noCheck: true` for syntax-only editor checking.
- Extra: `src/examples/mindcraft.d.ts` ambient stub to satisfy module resolution in editor.
- Extra: `biome.json` override disables `noExplicitAny` for `src/examples/**`.
- Bug found: ts-compiler `dist/` was stale; rebuilt all local deps to fix.
- Deviation: spec didn't anticipate the editor-side tsconfig/ambient needs.
