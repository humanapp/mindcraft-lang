# Mindcraft Workspaces Implementation Plan

Status: Draft
Date: 2026-05-07

## Scope And Sibling Specs

This spec covers the local-first Workspaces feature for Mindcraft apps.
Workspace is the user-facing product term. Internally, the ownership boundary
is a `ProjectCollection`: a named container that owns projects, may optionally
be protected by a PIN, and is the natural place to attach future publishing and
cloud-sync authority.

There is only one kind of project collection. The product does not distinguish
Guest, User, or Named workspaces. Apps bootstrap one unpinned project collection
displayed as `Default Workspace`.

This spec builds on the file-system naming cleanup that separates product
workspaces from project file trees:

- Existing project file tree APIs use `ProjectFileSystem`.
- Bridge snapshots use `FileSystemSnapshot`.
- Bridge-app owns the conversion boundary between app-host project files and
  bridge-client snapshots.

## Goal

```text
App boot
  -> ensure Default Workspace exists
  -> resolve active tab project collection
  -> ProjectManager scopes project operations to projectCollectionId

Main menu
  -> Workspaces...
  -> Workspace Explorer
       -> create / rename / switch / delete project collection
       -> configure optional PIN

Project
  -> belongs to exactly one project collection
  -> can be copied across project collections by content copy
  -> never carries publish/user authority during copy/remix
```

The primary seam this spec enforces is:

```text
ProjectCollection owns projects.
PIN protects a project collection when configured.
```

PIN protection is a behavioral shared-device protection mechanism, not
cryptographic local-data protection.

## Non-Goals

- No `workspaceMode` setting.
- No Guest/User/Named workspace categories.
- No accounts, OAuth, identity providers, ACLs, or teams.
- No local project encryption.
- No publishing implementation.
- No cloud sync implementation.
- No real-time collaboration.
- No per-project PINs.
- No speculative storage fields such as `credentialVersion` unless the same
  phase uses them for a concrete migration or verification path.

## No Backward Compatibility (within the repo)

- No deprecation aliases for Guest/User/Named workspace categories. The product
  model moves directly to one project collection type with optional PIN
  protection.
- No `WorkspaceKind`, `GuestWorkspace`, `NamedWorkspace`, or equivalent category
  flag. Existing code must migrate to the single `ProjectCollection` shape.
- No parallel "old project store / new project collection store" path. After
  W2, every persisted project has a `projectCollectionId`; old records are read
  only through the migration path into `Default Workspace`.
- No compatibility wrappers for unscoped `ProjectStore` or `ProjectManager`
  APIs after their owning phase updates all call sites. Scope-bearing APIs
  replace them in the same phase.
- No dual restore model after W4. Existing `localStorage` startup fallback may
  remain only where W4 explicitly keeps it; tab-scoped project collection/project
  restore is owned by `sessionStorage`.
- No phase / unit markers in shipped code. Do not embed strings like `W0`, `W1`,
  or references to this spec file in source comments, tests, JSDoc, or
  config-file comments.

## Prerequisites

The following cleanup should be complete before this plan begins:

- Existing file-tree "workspace" API renamed to `ProjectFileSystem`.
- Bridge snapshot boundary clarified with `FileSystemSnapshot`.
- Generated/compiler/example project files filtered from inbound bridge sync.
- Stale project-file "workspace" wording removed where it would confuse the
  product workspace concept.

If those prerequisites slip, do not build project collection ownership on top of
the ambiguous file-tree vocabulary. Restore the naming boundary first.

## Project Collection Concerns Audit

| # | Concern | Owner |
| - | ------- | ----- |
| 1 | Project collection metadata CRUD | `packages/app-host` storage layer |
| 2 | Default project collection bootstrap | `ProjectStore` / `ProjectManager` initialization |
| 3 | Existing project migration | app-host persistence implementations |
| 4 | Project membership by `projectCollectionId` | `ProjectManifest` / project metadata storage |
| 5 | Active project collection lifecycle | `ProjectManager` |
| 6 | Per-tab restore state | app-host session integration and app startup wiring |
| 7 | Workspace Explorer UI | app UI, initially `apps/sim` |
| 8 | Optional PIN verifier | app-host project collection model plus app UI |
| 9 | Unlock state and reload token | per-tab in-memory/sessionStorage state |
| 10 | Cross-project-collection copy/remix | app-host import/duplicate APIs |
| 11 | Publishing authority | future publishing feature; this plan reserves the ownership boundary only |

## Desired End State

`ProjectCollection` exists as the local ownership metadata shape:

```ts
interface ProjectCollection {
  projectCollectionId: string;
  name: string;
  pinVerifier?: ProjectCollectionPinVerifier;
  createdAt: string;
  updatedAt: string;
}
```

`LocalProject` or the equivalent persisted project manifest includes
`projectCollectionId`.

```ts
interface LocalProject {
  localProjectId: string;
  projectCollectionId: string;
}
```

`ProjectManager` always operates inside one active project collection context. Project
listing, creation, opening, deletion, duplication, import, and export all run
against the active project collection unless an API explicitly states it is
crossing a project collection boundary.

The app starts by ensuring at least one project collection exists. If no project
collections exist, it creates:

```text
Default Workspace
```

The initial project collection is unpinned.

Reload restores the current tab's project collection and project. New tabs do
not inherit per-tab unlocked state. Existing `localStorage` usage for app
settings and UI preferences remains intact; `sessionStorage` is used for
tab-scoped project collection session state.

PIN protection is optional. A project collection with no `pinVerifier` is
immediately usable. A project collection with a `pinVerifier` starts locked in a
new tab and must be unlocked before projects in that collection can be opened,
edited, deleted, or published by future publishing flows.

## Key Invariants

- Every project belongs to exactly one project collection.
- A project API must not accidentally operate across project collection
  boundaries.
- `Default Workspace` exists whenever storage would otherwise contain zero
  project collections.
- PIN verifier is stored; raw PIN is never stored.
- Unlock state is per-tab.
- A reload unlock token, if present, is short-lived and tamper-resistant.
- Workspace switching locks the previously active protected project collection.
- Copy/remix across project collections copies project content only.
- Copy/remix does not copy publish authority or future user/project collection
  authority metadata.
- Existing projects migrate into `Default Workspace`.
- No Guest/User/Named terminology survives in product or technical surfaces.
- `Workspace` remains the UI term; `ProjectCollection` is the technical domain
  noun.

## Security Model

Project collection PIN protection prevents casual misuse on a shared device. It
does not encrypt project data at rest and does not defend against browser
developer tools, local IndexedDB inspection, or determined extraction.

The reload token exists for ergonomics. It allows tab reload to reopen a
recently unlocked protected project collection without making tab reload a lock
boundary. The token must not be trivially forgeable by editing `expiresAt`; use
a local signature or MAC over the token payload.

## Storage Responsibilities

- IndexedDB stores project collection metadata, project metadata, project files,
  app data, future authority metadata, and autosave state.
- `sessionStorage` stores tab-scoped active project collection/project session
  state and any short-lived reload unlock token.
- `localStorage` remains appropriate for app settings, UI preferences, and
  existing app-level startup fallbacks that are intentionally not tab-scoped.

## Workflow Convention

Phases ship one at a time and are numbered W0-W8. Each phase follows this loop:

1. Implement the phase.
2. Stop and present work for review.
3. The user reviews, requests changes, or approves.
4. Only after the user declares the unit complete should a post-mortem update
   be written.

Do not amend Current State, Phase Log, or risks during implementation.

### Post-Mortem Content Rules

Phase Log entries are forward-looking notes for future implementers, not a
changelog. Keep each entry to 5-15 lines.

Include only:

- One-sentence summary of what shipped.
- Any new spec section, contract surface, or public API added.
- Verification line.

Do not include:

- File lists.
- Import bookkeeping.
- Test-construction details.
- Per-test enumeration.
- Before/after diffs.
- Restatement of the phase deliverables.
- Justification of why the implementation looks the way it does.

Risks should be recorded when they imply a concrete future action, expose a
behavior change, document a gap between spec and implementation, or identify a
rough edge that later phases could trip over.

## Unit Gates

Each phase must run the full relevant package gates for the packages it changes.
At minimum:

- `packages/app-host`: `npm run typecheck`, `npm run check`, `npm test`,
  `npm run build`.
- `packages/bridge-app`: typecheck/check/test/build when app-host public APIs
  or bridge integration change.
- `apps/sim`: typecheck/check/build when app integration or UI changes.
- `apps/vscode-extension` and `apps/vscode-bridge`: relevant gates when bridge
  protocol or bridge-client contracts change.

Each phase must add its own tests for behavior it introduces. No "tests will
follow."

## Current State

Completed: None
Next up: W0

---

## Phase Log

No phases completed.

---

## Phase W0 -- Storage And Session Decisions

Purpose: pin the exact persistence and session decisions needed by the
implementation phases.

Deliverables:

- Audit current IndexedDB, `localStorage`, and `sessionStorage` usage in the
  sim/app-host startup path.
- Decide project collection object store shape and indexes.
- Decide project metadata migration shape.
- Decide active tab project collection/project restore keys.
- Decide last-project-collection deletion behavior.
- Decide whether project collection delete is blocked for the active project
  collection or allowed through a destructive switch-and-delete flow.

Acceptance:

- W1 and W2 can be implemented without inventing storage policy.
- Every storage location has a named owner and reason.
- Any unresolved decision is explicitly called out before implementation stops.

Source paths to inspect:

- `packages/app-host/src/project-store.ts`
- `packages/app-host/src/idb-project-store.ts`
- `packages/app-host/src/local-storage-project-store.ts`
- `packages/app-host/src/project-manager.ts`
- `apps/sim/src/services/sim-environment-store.ts`
- Current app settings, UI preferences, and binding-token storage helpers.

Gate:

- No code gate required unless W0 captures decisions in code or docs.

## Phase W1 -- Project Collection Metadata Store

Purpose: add project collection persistence without changing visible app
behavior.

Deliverables:

- Add `ProjectCollection` and `ProjectCollectionPinVerifier` types.
- Add project collection CRUD to `ProjectStore`.
- Update IndexedDB and localStorage-backed store implementations.
- Bootstrap `Default Workspace` when no project collection exists.
- Add tests for create/list/get/update/delete/bootstrap.

Acceptance:

- Existing app behavior remains effectively single-collection.
- `Default Workspace` is created exactly when storage has no project
  collections.
- Project collection metadata round-trips through both store implementations.
- No PIN unlock behavior exists yet.

Gate:

- `packages/app-host`: full gate.

## Phase W2 -- Project Collection Membership Migration

Purpose: make project persistence project-collection-owned.

Deliverables:

- Add `projectCollectionId` to persisted project metadata.
- Migrate existing project metadata into `Default Workspace`.
- Add project-collection-scoped project listing/loading APIs or parameters.
- Ensure new projects are created in a project collection.
- Add migration tests for old data.

Acceptance:

- Existing projects survive migration.
- Loaded project metadata always has `projectCollectionId`.
- Projects created after migration store the active/default
  `projectCollectionId`.
- No project is orphaned after migration.

Gate:

- `packages/app-host`: full gate.
- `packages/bridge-app`: typecheck/check.
- `apps/sim`: typecheck/check.

## Phase W3 -- ProjectManager Project Collection Context

Purpose: make project lifecycle project-collection-scoped internally.

Deliverables:

- `ProjectManager` owns or receives an active project collection context.
- Project listing, create, open, delete, duplicate, import, and export scope to
  the active project collection.
- Workspace switch closes/saves the current project and opens/restores a project
  in the target project collection.
- Cross-project-collection project access is rejected by normal active-project-
  collection APIs.

Acceptance:

- Project lists contain only active project collection projects.
- Opening a project from another project collection through active-project-
  collection APIs fails.
- Current single-collection startup behavior remains unchanged.
- Autosave and project file persistence remain scoped to the active project.

Gate:

- `packages/app-host`: full gate.
- `packages/bridge-app`: typecheck/check/test/build if API contracts change.
- `apps/sim`: typecheck/check.

## Phase W4 -- Tab Restore Semantics

Purpose: make reload behavior correct before adding visible workspace switching.

Deliverables:

- Store current tab `projectCollectionId` and active project ID in
  `sessionStorage`.
- Keep existing `localStorage` app settings and UI preference behavior intact.
- Reload reopens the same project collection/project in the same tab.
- New tabs do not inherit tab-scoped unlocked state.
- Add tests for reload restore and stale project collection/project IDs.

Acceptance:

- Reload restores current tab project collection/project.
- Stale tab session state falls back safely.
- New tab behavior is not treated as an unlock carry-forward path.

Gate:

- `packages/app-host`: full gate.
- `apps/sim`: typecheck/check.

## Phase W5 -- Workspace Explorer, No PIN

Purpose: expose workspace management while all project collections are
unprotected.

Deliverables:

- Add main menu item `Workspaces...`.
- Add Workspace Explorer UI.
- Create project collection.
- Rename project collection.
- Switch project collection.
- Delete project collection with W0 safeguards.
- Show empty/default states.

Acceptance:

- Users can manage multiple unpinned project collections.
- Switching workspace updates project list and active project collection
  context.
- Deleting the last project collection follows the W0 decision.
- UI does not mention Guest/User/Named workspace categories.

Gate:

- `apps/sim`: typecheck/check/build.
- `packages/app-host` and `packages/bridge-app`: relevant gates if touched.

## Phase W6 -- Optional PIN Protection

Purpose: add protection as a project collection property, not a workspace kind.

Deliverables:

- Store verifier, never raw PIN.
- Add Workspace Settings controls for set/change/remove PIN.
- Add locked/unlocked state in memory.
- Require unlock before opening, editing, deleting, or future-publishing from a
  protected project collection.
- Lock previous protected project collection on workspace switch.
- Add short-lived signed/MACed reload token in `sessionStorage`.
- Add tests for verifier behavior, unlock state, reload token expiry, and token
  tampering.

Acceptance:

- Unpinned project collections remain frictionless.
- Protected project collection reload works inside the token window.
- Editing token expiry invalidates the token.
- New tab starts locked for protected project collections.
- Switching away locks protected project collection state.

Gate:

- `packages/app-host`: full gate.
- `apps/sim`: typecheck/check/build.

## Phase W7 -- Cross-Project-Collection Copy, Import, And Authority Hygiene

Purpose: make ownership transfer explicit.

Deliverables:

- Import creates a project in the active unlocked project collection.
- Duplicate within a project collection copies full project content.
- Copy/remix to another project collection copies project content only.
- Exclude publish authority and future user/project collection authority
  metadata.
- Require unlock for protected source/target project collection as appropriate.

Acceptance:

- No project moves silently between project collections.
- Cross-project-collection copy/remix never copies authority metadata.
- Protected target project collection must be unlocked to receive
  copied/imported project content.

Gate:

- `packages/app-host`: full gate.
- `apps/sim`: relevant gates.

## Phase W8 -- Lock-In And Cleanup

Purpose: remove conceptual drift before publishing or cloud sync build on top of
project collections.

Deliverables:

- Remove remaining Guest/User/Named workspace terminology.
- Confirm no `WorkspaceKind` or equivalent category flag exists.
- Audit IndexedDB, `localStorage`, and `sessionStorage` usage after W1-W7.
- Add or update multi-tab behavior tests.
- Polish Workspace Explorer empty states and destructive confirmations.
- Document the final workspace UI and `ProjectCollection` internal model in the
  appropriate product/spec docs.

Acceptance:

- Project collection model is stable enough for publishing authority work.
- All changed package gates are green.
- No future publishing/cloud phase needs to reinterpret project ownership.

Gate:

- Full relevant gates for every touched package.
