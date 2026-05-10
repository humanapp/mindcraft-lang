# Mindcraft Workspaces Implementation Plan

Status: Draft
Date: 2026-05-07

## Scope

This spec covers the local-first Workspaces feature for Mindcraft apps.
Workspace is the user-facing product term. Internally, the ownership boundary
is a `ProjectCollection`: a named container that owns projects, may optionally
be protected by a PIN, and scopes project storage and project operations.

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

App header workspace selector
  -> create / rename / select / delete project collection
  -> configure optional PIN

Project
  -> belongs to exactly one project collection
  -> can be copied across project collections by content copy
```

The primary seam this spec enforces is:

```text
ProjectCollection owns projects.
PIN protects a project collection when configured.
```

PIN protection is a behavioral multi-user device protection mechanism, not
cryptographic local-data protection.

## Non-Goals

- No `workspaceMode` setting.
- No Guest/User/Named workspace categories.
- No accounts, OAuth, identity providers, ACLs, or teams.
- No local project encryption.
- No real-time collaboration.
- No per-project PINs.
- No tombstone garbage collection.
- No recovery UI or API for tombstoned projects or project collections.
- No bridge protocol changes.
- No changes to bridge-app, bridge-client, VS Code bridge, or extension network
  payload shapes.
- No speculative storage fields. Stored fields must be consumed by the phase
  that introduces them.

## No Backward Compatibility

This plan defaults to abandoning old local data when a phase changes a storage
key, API shape, persisted field, or product model. Do not preserve old behavior
by adding alias reads, fallback reads, dual writes, compatibility wrappers,
legacy branch paths, key-copy migrations, or best-effort data rescue unless the
owning phase explicitly names that exact migration. "Migrate" in this plan means
only a migration named by a phase deliverable or acceptance item, not a general
permission to keep old data working.

- No deprecation aliases for Guest/User/Named workspace categories. The product
  model moves directly to one project collection type with optional PIN
  protection.
- No `WorkspaceKind`, `GuestWorkspace`, `NamedWorkspace`, or equivalent category
  flag. Existing code must be updated directly to the single
  `ProjectCollection` shape.
- No parallel "old project store / new project collection store" path. After
  W2, every persisted project has a `projectCollectionId`; old records are read
  only through the migration path into `Default Workspace`.
- No app-owned localStorage compatibility. When app-owned keys move under the
  app namespace, old unscoped or differently scoped app-settings, UI-preference,
  binding-token, and user-tile metadata keys are ignored. Do not read from them,
  copy from them, write to them, or clear them as part of a compatibility path.
- No hard deletion of project collection or project records from IndexedDB.
  Delete operations update stored records with `deleted: true`.
- No compatibility wrappers for unscoped `ProjectStore` or `ProjectManager`
  APIs after their owning phase updates all call sites. Scope-bearing APIs
  replace them in the same phase.
- No dual restore model after W4. Existing `localStorage` startup fallback may
  remain only where W4 explicitly keeps it; tab-scoped project collection/project
  restore is owned by `sessionStorage`.
- No compatibility bridge payloads. Workspaces must remain an app-host/app UI
  concern and must not add fields to bridge protocol messages, bridge-client
  snapshots, VS Code bridge messages, or extension network payloads.
- No phase / unit markers in shipped code. Do not embed strings like `W0`, `W1`,
  or references to this spec file in source comments, tests, JSDoc, or
  config-file comments.

## Prerequisites

The following cleanup should be complete before this plan begins:

- Existing file-tree "workspace" API renamed to `ProjectFileSystem`.
- Bridge snapshot boundary clarified with `FileSystemSnapshot`.
- Generated/compiler/example project files filtered from inbound bridge
  snapshots.
- Stale project-file "workspace" wording removed where it would confuse the
  product workspace concept.

If those prerequisites slip, do not build project collection ownership on top of
the ambiguous file-tree vocabulary. Restore the naming boundary first.

## Project Collection Concerns Audit

| #   | Concern                                        | Owner                                               |
| --- | ---------------------------------------------- | --------------------------------------------------- |
| 1   | Project collection metadata CRUD               | `packages/app-host` storage layer                   |
| 2   | Default project collection bootstrap           | `ProjectStore` / `ProjectManager` initialization    |
| 3   | Project metadata default collection assignment | app-host persistence implementations                |
| 4   | Project membership by `projectCollectionId`    | `ProjectManifest` / project metadata storage        |
| 5   | Active project collection lifecycle            | `ProjectManager`                                    |
| 6   | Per-tab restore state                          | app-host session integration and app startup wiring |
| 7   | Workspace selector UI                          | app UI, initially `apps/sim`                        |
| 8   | Optional PIN verifier                          | app-host project collection model plus app UI       |
| 9   | Unlock state and reload unlock record          | `ProjectManager` and sessionStorage helpers         |
| 10  | Cross-project-collection copy/remix            | app-host import/duplicate APIs                      |

## Desired End State

`ProjectCollection` exists as the local ownership metadata shape:

```ts
interface ProjectCollection {
  projectCollectionId: string;
  name: string;
  pinVerifier?: ProjectCollectionPinVerifier;
  deleted?: true;
  createdAt: number;
  updatedAt: number;
}
```

`createdAt` and `updatedAt` are numeric timestamps.

`ProjectManifest` includes `projectCollectionId`.

```ts
interface ProjectManifest {
  id: string;
  projectCollectionId: string;
  name: string;
  description: string;
  thumbnailUrl?: string;
  deleted?: true;
  createdAt: number;
  updatedAt: number;
}
```

`ProjectManager` always operates inside one active project collection context. Project
listing, creation, opening, deletion, duplication, import, and export all run
against the active project collection unless an API explicitly states it is
crossing a project collection boundary.

UI responsiveness comes from app-host state subscriptions. `ProjectManager` is
the source of truth for active project collection, active project, and locked
state. App UI subscribes to manager state snapshots and rerenders from those
snapshots. App UI does not subscribe directly to `BroadcastChannel`,
`sessionStorage`, or lock internals.

The app starts by ensuring a non-deleted default project collection exists at
`DEFAULT_PROJECT_COLLECTION_ID`. If no non-deleted project collection exists
with that ID, it creates one with the initial display name:

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
edited, or deleted.

Project collection and project deletes are tombstones. Deleting either record
sets `deleted: true` on the stored IndexedDB record and updates `updatedAt`.
Normal list, open, switch, edit, duplicate, export, and import-target paths
treat records with `deleted === true` as unavailable.

## Tombstone Retention

No tombstone garbage collection is implemented in this plan. Tombstoned project
collection and project records remain in IndexedDB indefinitely.

Public app-host APIs hide tombstoned project collection and project records.
Raw tombstone visibility is limited to private migration helpers, private test
helpers, or explicit debug-only tooling.

Do not add `deletedAt`. The existing `updatedAt` field is updated when a record
is tombstoned and can serve as the tombstone age marker if a future maintenance
feature adds hard-delete garbage collection.

The default collection is identified by `projectCollectionId ===
DEFAULT_PROJECT_COLLECTION_ID`, not by name. `DEFAULT_PROJECT_COLLECTION_NAME`
is only the initial display name. Project collection names do not need to be
unique.

Renaming the default collection does not transfer default status. Creating a
non-default collection named `Default Workspace` is allowed and does not make
that collection the default collection.

`projectCollectionId` is local ownership metadata. Exported project JSON must
not include it.

The PIN verifier is stored directly on the IndexedDB project collection record
as `pinVerifier`. If that field is missing or cleared, the project collection is
treated as unprotected. There is no separate verifier object store.

## App Isolation

Each app owns a stable local storage namespace. In app-host APIs this is the
existing `keyPrefix`. The sim app currently passes its package name,
`@mindcraft-lang/sim`, as `keyPrefix`. The namespace is local storage identity,
not display text.

Do not rely on hostname or subdomain isolation alone. Production apps may run
under different subdomains, such as `sim.mindcraft-lang.org` and
`lbb.mindcraft-lang.org`, but development and preview environments may put more
than one app under the same browser origin. Different apps must still not mix
datasets or cross-tab notifications.

The app namespace scopes:

- IndexedDB database names.
- `sessionStorage` keys, including `${keyPrefix}:project-session`.
- App-owned `localStorage` keys, including app settings, UI preferences,
  binding tokens, and user-tile metadata caches.
- Web Lock names used for project locking.
- BroadcastChannel names, including `${keyPrefix}:project-collections`.

`DEFAULT_PROJECT_COLLECTION_ID` is well-known only inside one app namespace. Two
apps may both have a project collection with `projectCollectionId ===
DEFAULT_PROJECT_COLLECTION_ID`; those records live in different app-scoped
IndexedDB databases and use different app-scoped coordination channels.

App isolation invariants:

- `ProjectCollection` and `ProjectManifest` records are never visible across app
  namespaces.
- BroadcastChannel listeners only subscribe to the current app namespace.
- Web Locks for one app namespace cannot block or observe another app namespace.
- Tests for cross-tab behavior must include a different-namespace case where
  records, locks, and broadcasts do not cross.

## Key Invariants

- Every project belongs to exactly one project collection.
- Every project collection and project belongs to exactly one app namespace.
- A project API must not accidentally operate across project collection
  boundaries.
- A project API must not accidentally operate across app namespace boundaries.
- Project collection and project delete operations tombstone records with
  `deleted: true`; they do not hard-delete the records from IndexedDB.
- Tombstoned records are retained indefinitely by this plan.
- No `deletedAt` field exists.
- Normal user-facing APIs exclude records where `deleted === true`.
- The default project collection uses a well-known static
  `projectCollectionId` and cannot be deleted.
- Project collection names are not unique identifiers and no API enforces name
  uniqueness.
- PIN verifier is stored on the project collection record; raw PIN is never
  stored.
- Missing verifier means unprotected project collection.
- There is no manual project save flow; project state persists through autosave.
- Unlock state is per-tab.
- A reload unlock record, if present, is short-lived and stored only in
  `sessionStorage`.
- Workspace switching locks the previously active protected project collection.
- The active project collection in a tab cannot be deleted from that tab.
- Project collection UI state is observed through app-host subscriptions, not
  by reading storage or BroadcastChannel directly from app UI.
- Bridge protocol and bridge network payload shapes remain unchanged.
- App namespace scoping is local-only and must not change bridge protocol,
  bridge payload, or extension network payload shapes.
- Copy/remix across project collections copies project content only.
- Exported project JSON does not include `projectCollectionId`.
- Existing projects migrate into `Default Workspace`.
- No Guest/User/Named terminology survives in product or technical surfaces.
- `Workspace` remains the UI term; `ProjectCollection` is the technical domain
  noun.

## Security Model

Project collection PIN protection prevents casual misuse on a multi-user device.
It does not encrypt project data at rest and does not defend against browser
developer tools, local IndexedDB inspection, or determined extraction.

PIN verifier deletion is not a data-loss or recovery-lockout case. Clearing the
stored `pinVerifier` field removes protection from that project collection.

The reload unlock record exists for ergonomics. It allows tab reload to reopen a
recently unlocked protected project collection without making tab reload a lock
boundary. It is not designed to resist a user editing `sessionStorage` through
browser developer tools.

No unlock attempt rate limiting is implemented. The threat model treats local
IndexedDB extraction and browser developer tools as out of scope, so UI-level
rate limiting does not provide meaningful protection.

## Recovery Model

Recovery of tombstoned projects and project collections is out of scope for
this spec. Tombstoned records are retained but no user-facing restore flow,
public restore API, or internal recovery contract is implemented in W1-W8.

If browser storage is cleared, this feature does not attempt recovery. On the
next app boot, the normal default collection bootstrap path runs against the
remaining storage state.

## Autosave Model

Mindcraft has no manual "save project" operation. Project changes autosave to
IndexedDB through a short debounce.

Project collection lifecycle flows must not introduce save prompts, dirty-state
confirmation as a substitute for persistence, or a user-visible save action.
When switching project collections, closing a project, reloading a tab, or
deleting a project, implementation must rely on the autosave contract and
flush any pending debounced autosave before replacing or discarding the active
project context.

## Multi-Tab Concurrency

Each browser tab owns its own active project collection and active project
session. Workspace switching in one tab must not change the active project
collection in another tab.

Intended behavior:

- A tab reload restores that tab's active project collection and active project
  from `sessionStorage`.
- A new tab does not inherit another tab's `sessionStorage` state, unlock state,
  or reload unlock record.
- Multiple tabs may have different active project collections at the same time.
- Multiple tabs may have the same active project collection, but protected
  collection unlock state remains per-tab.
- Unlocking, locking, or switching away from a protected project collection in
  one tab does not unlock, lock, or switch another tab.
- Existing project-level locking remains in force. Workspaces must not allow the
  same project to be edited concurrently in multiple tabs when the project lock
  would currently reject that.
- Tombstone operations broadcast same-origin, app-scoped notifications through
  `BroadcastChannel` when available.
- If another tab tombstones the active project or active project collection,
  the current tab must stop autosave and close or replace the active context
  after the broadcast is observed. If `BroadcastChannel` is unavailable or a
  message is missed, the next guarded operation detects the tombstone and stops
  the write.
- `localStorage` app settings and UI preferences remain browser-profile
  state. They are not workspace session state.

Read-time tombstone exclusion:

- List APIs exclude tombstoned project and project collection records.
- Open, switch, duplicate, export, import-target, and delete target resolution
  treats tombstoned records as unavailable.
- Read-time exclusion is the user-facing availability rule. It determines what
  the app can present as selectable, openable, exportable, or deletable.

Write-time tombstone re-check:

- Mutations must re-check that the target project and project collection are
  still non-deleted immediately before writing.
- Autosave, app-data saves, project-file saves, project metadata updates, and
  project collection updates are guarded write paths.
- Guarded write paths must re-read the project and project collection before
  writing and reject the write when either record is tombstoned.
- Write-time re-checks are the correctness rule for stale tabs, missed
  broadcasts, and races between read-time selection and later mutation.

The BroadcastChannel wrapper contract is defined in W4. Its channel name is
`${keyPrefix}:project-collections`, where `keyPrefix` is the current app
storage namespace. Broadcast messages are a responsiveness mechanism, not the
correctness mechanism. Correctness comes from guarded read-before-write checks.

Invariants:

- Active project collection and active project restore state is tab-scoped.
- Protected project collection unlock state is tab-scoped.
- Reload unlock records are tab-scoped and short-lived.
- Cross-tab concurrency must not require bridge protocol, bridge payload, or
  extension payload changes.
- Cross-app isolation must not require bridge protocol, bridge payload, or
  extension payload changes.
- Cross-tab broadcasts, Web Locks, and tab session state are scoped by app
  namespace.
- Project autosave must flush before a tab replaces or discards its active
  project context.
- Tombstoned project or collection records cannot be modified by autosave or
  app-data writes after the write path re-checks IndexedDB state.

## Storage Responsibilities

- IndexedDB stores project collection metadata, project metadata, project files,
  app data, and autosave state. W6 adds the `pinVerifier` field to project
  collection records.
- `sessionStorage` stores tab-scoped active project collection/project session
  state and any short-lived reload unlock record.
- `localStorage` remains appropriate for app settings and UI preferences.

## Workflow Convention

Phases ship one at a time and are numbered W0-W8, with W5 split into W5a and
W5b. Each phase or subphase follows this loop:

1. Before implementing, run the phase compatibility audit below.
2. Implement the phase.
3. Stop and present work for review.
4. The user reviews, requests changes, or approves.
5. Only after the user declares the unit complete should a post-mortem update
   be written.

Do not amend Current State, Phase Log, or risks during implementation.

### Phase Compatibility Audit

Every phase starts with a fresh compatibility audit. This is required even when
the phase appears unrelated to persistence. Before writing code or docs, read
the full No Backward Compatibility section and scan this spec plus the files the
phase will touch for compatibility vocabulary, including:

```text
alias, fallback, legacy, migrate, migration, old, previous, preserve, restore,
compatibility, compatible, wrapper, dual, deprecate, existing data
```

For every hit, classify it before proceeding:

- Allowed only when the current phase explicitly names that exact migration or
  fallback behavior in its deliverables or acceptance.
- Otherwise remove or rewrite the behavior as a direct model/key/API change
  with old data abandoned.
- If classification is ambiguous, stop and resolve the spec before
  implementation.

The review handoff for every phase must include a "Backward compatibility
audit" line that states whether any aliases, fallback reads, dual writes,
compatibility wrappers, legacy key reads, or unapproved migrations remain.

### Post-Mortem Content Rules

Phase Log entries are forward-looking notes for future implementers, not a
changelog. Keep each entry to 5-15 lines.

Include only:

- One-sentence summary of what shipped.
- Any new spec section, contract surface, or public API added.
- Verification line.
- New risks (see below for description)

Do not include:

- File lists.
- Import bookkeeping.
- Test-construction details.
- Per-test enumeration.
- Before/after diffs.
- Restatement of the phase deliverables.
- Justification of why the implementation looks the way it does.

#### Risks

Risks should be recorded when they imply a concrete future action, expose a
behavior change, document a gap between spec and implementation, or identify a
rough edge that later phases could trip over.

## Unit Gates

Each phase must run the full relevant package gates for the packages it changes.
At minimum:

- `packages/app-host`: `npm run typecheck`, `npm run check`, `npm test`,
  `npm run build`.
- `apps/sim`: typecheck/check/build when app integration or UI changes.
- Bridge packages and VS Code packages must not change for this feature. If an
  implementation appears to require such a change, stop and revise the design.

Each phase must add its own tests for behavior it introduces. No "tests will
follow."

## Current State

Completed: W0, W1, W2, W3, W4, W5a, W5b
Next up: W6

---

## Phase Log

### W0 -- Storage And Session Decisions

W0 shipped a durable storage/session audit that fixes the implementation
checklist for project collection persistence, tab restore, app namespace
scoping, tombstone behavior, autosave flush points, and bridge isolation.

New spec surface: `W0 Audit Result` records audited owners and W4 now requires
app-owned localStorage keys to use the app namespace without legacy key
fallbacks.

Verification: documentation-only phase; no code gate was required.

### W1 -- Project Collection Metadata Store

W1 shipped project collection metadata persistence in app-host without changing
ProjectManager behavior or project membership.

New public API: `ProjectCollection`,
`DEFAULT_PROJECT_COLLECTION_ID`, `DEFAULT_PROJECT_COLLECTION_NAME`, and
project collection CRUD/default-bootstrap methods on `ProjectStore`.

Verification: `npm run typecheck && npm run check && npm test && npm run build`
passed in `packages/app-host`.

### W2 -- Project Collection Membership Migration

W2 shipped project collection ownership for persisted projects while preserving
the current single-default-collection app behavior.

New public API: `ProjectManifest.projectCollectionId`,
`ProjectManifest.deleted`, `ProjectStore.listProjects(projectCollectionId)`,
and `ProjectStore.createProject(projectCollectionId, name)`.

Verification: `npm run typecheck && npm run check && npm test && npm run build`
passed in `packages/app-host`; `npm run typecheck && npm run check` passed in
`apps/sim`.

Risk: W4 still owns guarded file/app-data write re-checks and the tab-scoped
project session shape, so stale-tab tombstone correctness is not complete until
that phase lands.

### W3 -- ProjectManager Project Collection Context

W3 shipped active project collection context in app-host and scoped normal
ProjectManager project lifecycle operations to that active collection.

New public API: `ProjectCollectionState`,
`ProjectCollectionSwitchResult`, project collection state subscriptions,
ProjectManager collection CRUD/switch methods, app-host error codes, import
diagnostic codes, and project collection name normalization.

Verification: `npm run typecheck && npm run check && npm test && npm run build`
passed in `packages/app-host`; `npm run typecheck && npm run check` passed in
`apps/sim`.

Risk: W4 must replace the active-project-only restore path with
`ProjectCollectionTabSession` and should share stale-session fallback behavior
across init, switch, and later unlock restore paths.

Risk: W5b/W6 UI should surface project collection name validation by app-host
error code and avoid duplicating a divergent trim or length policy.

### W4 -- Multi-Tab And Tab Restore Semantics

W4 shipped tab-scoped project collection/project restore, cross-tab tombstone
broadcast recovery, guarded stale-write rejection, and app-owned storage key
namespacing before visible workspace switching.

New public API: `ProjectCollectionTabSession`,
`ProjectManager.dispose()`, `ProjectPersistenceError`, and
`ProjectManager.onProjectPersistenceError`.

Verification: full gates passed in `packages/app-host`,
`packages/bridge-app`, and `apps/sim`.

Risk: W5b should attach toast or visible app feedback to
`ProjectManager.onProjectPersistenceError` so non-tombstone autosave failures
are visible in the app UI.

### W5a -- Workspace UI Data APIs

W5a shipped app-host watcher and commit APIs for workspace selector rows,
collection-scoped project lists, committed workspace state, and pending
workspace/project commits, without adding visible workspace UI.

New public API: `ProjectCollectionEvent`, `ProjectCollectionSummary`,
`ProjectCollectionSummaryChange`, `ProjectCollectionProjectCommitResult`,
`watchProjectCollectionState`, `watchProjectCollectionSummaries`,
`listProjectsForCollection`, `watchProjectListForCollection`,
`switchProjectCollectionAndOpenProject`, and
`switchProjectCollectionAndCreateProject`.

Verification: `npm run typecheck`, `npm run check`, `npm test`, and
`npm run build` passed in `packages/app-host`.

### W5b -- Workspace Selector and Pending Project Picker UX

W5b shipped the visible workspace selector, workspace create/rename/delete
flows, pending workspace project picker routing, and committed header context.

New contract surface: `AppEnvironmentHost` wraps pending workspace project
commits, and the project picker accepts workspace-scoped browsing context while
disabling project deletion for pending workspaces.

Verification: `apps/sim` typecheck/check/build, `packages/app-host`
typecheck/check/test/build, `packages/bridge-app` typecheck/check/build, and
`packages/ui` typecheck/check passed.

Risk: W5b touched `packages/bridge-app` despite the original gate text; future
bridge-adjacent phases should keep protocol/payloads unchanged while treating
`AppEnvironmentHost` as app integration gate coverage.

---

## Phase W0 -- Storage And Session Decisions

Purpose: turn the storage/session policy into an implementation checklist before
schema work begins. This phase should not invent runtime behavior; it should
confirm exact current call paths and update this spec only if the audit exposes
a contradiction.

Fixed decisions for later phases:

- The IndexedDB store is the only project persistence implementation.
- Project collection records live in a new `projectCollections` object store
  keyed by `projectCollectionId`.
- Project records remain in the existing `projects` object store keyed by `id`.
- Project records gain `projectCollectionId` and `deleted?: true`.
- Project collection records gain `deleted?: true`.
- The bootstrap project collection record uses
  `DEFAULT_PROJECT_COLLECTION_ID`.
- Project collection deletion tombstones the collection and tombstones every
  non-deleted project whose `projectCollectionId` matches it.
- Project deletion tombstones the `ProjectManifest` only. Project files and
  app-data remain in IndexedDB.
- Normal public store/manager list and get APIs exclude tombstoned records.
- The active collection cannot be deleted. Since the active collection is always
  non-deleted, the last non-deleted collection cannot be deleted.
- The collection with `projectCollectionId === DEFAULT_PROJECT_COLLECTION_ID`
  cannot be deleted.
- Project collection names are display labels only and are not unique.
- Active project collection/project restore state is stored in `sessionStorage`
  only.
- Existing `localStorage` active-project restore is removed from the active
  project/session flow.
- `keyPrefix` is the app storage namespace and scopes IndexedDB,
  `sessionStorage`, `localStorage`, Web Locks, and BroadcastChannel names.
- Cross-tab tombstone responsiveness uses `BroadcastChannel`; write correctness
  uses guarded IndexedDB re-checks.

Deliverables:

- Write a `W0 Audit Result` subsection in this spec before W1 begins.
- The `W0 Audit Result` subsection must list each audited area, the inspected
  source paths, the confirmed owner/decision, and any follow-up spec edits made
  during W0.
- If the audit finds no contradiction, record that explicitly in
  `W0 Audit Result`.
- If the audit finds a contradiction, resolve it by editing the relevant spec
  section and summarize the resolution in `W0 Audit Result`.
- Do not leave W0 analysis only in chat, scratch notes, terminal output, or a
  separate untracked file.
- Audit current IndexedDB, `localStorage`, and `sessionStorage` usage in the
  sim/app-host startup path.
- Audit every `keyPrefix` use and confirm it is a required scoping component for
  app-owned IndexedDB database names, tab session keys, app settings/preferences
  keys, Web Lock names, and BroadcastChannel names.
- Confirm the `projectCollections`, `projects`, `files`, and `appData` stores
  can be updated without bridge protocol or payload changes.
- Confirm the project metadata migration can run in the IndexedDB `upgrade`
  path, create a default collection with `DEFAULT_PROJECT_COLLECTION_ID`, and
  assign every existing non-deleted project to it.
- Confirm default bootstrap gracefully handles a duplicate-key race by reading
  the existing `DEFAULT_PROJECT_COLLECTION_ID` record after create fails.
- Confirm the tab session key and value shape:

```ts
interface ProjectCollectionTabSession {
  projectCollectionId: string;
  activeProjectId?: string;
}
```

- Use session key `${keyPrefix}:project-session`.
- Audit current autosave timing and identify the flush point for active project
  replacement.
- Audit current project lock behavior and preserve it across project collection
  switching.
- Confirm project lock names are app-scoped by `keyPrefix`.
- Audit current save paths and identify every write path that must re-check
  project and collection tombstone state.
- Audit sim UI preference and app settings storage and confirm it remains
  outside project collection session state.

Acceptance:

- `W0 Audit Result` exists in this spec and contains the durable audit output.
- W1 and W2 can be implemented without inventing storage policy.
- Every storage location has a named owner and reason.
- Project collection and project records are tombstoned, not hard-deleted.
- Tombstoned records are hidden from public store and manager APIs.
- Project collection delete is blocked for the active project collection.
- Project collection delete is blocked for `DEFAULT_PROJECT_COLLECTION_ID`.
- Duplicate project collection names are allowed.
- Deleting a non-active project collection tombstones its projects.
- BroadcastChannel is used for tombstone notifications when available, with
  guarded write-path re-checks as the correctness fallback.
- Two different app namespaces can both use `DEFAULT_PROJECT_COLLECTION_ID`
  without exposing project collection records, project records, Web Locks, or
  BroadcastChannel messages to each other.
- There are no open storage or session decisions left for W1-W4.

Source paths to inspect:

- `packages/app-host/src/project-store.ts`
- `packages/app-host/src/idb-project-store.ts`
- `packages/app-host/src/project-lock.ts`
- `packages/app-host/src/project-manager.ts`
- `packages/app-host/src/project-manager.spec.ts`
- `packages/app-host/src/project-io.ts`
- `packages/app-host/src/project-io.spec.ts`
- `apps/sim/src/services/sim-environment-store.ts`
- Current app settings, UI preferences, and binding-token storage helpers.

Gate:

- No code gate required unless W0 captures decisions in code or docs.

### W0 Audit Result

Status: Complete.

Audited areas and source paths:

- Store contract and IndexedDB implementation:
  `packages/app-host/src/project-store.ts`,
  `packages/app-host/src/idb-project-store.ts`,
  `packages/app-host/src/project-manifest.ts`, and
  `packages/app-host/README.md`. The current owner for project metadata,
  project files, app-data blobs, and active-project restore is `ProjectStore`;
  the only persistence implementation is IndexedDB via `createIdbProjectStore`.
  The current database has `projects`, `files`, and `appData` stores at
  `DB_VERSION = 2`, with database names derived from `${keyPrefix}-projects`.
  W1 can add a `projectCollections` store keyed by `projectCollectionId`, and
  W2 can migrate `projects` records in the IndexedDB `upgrade` path without
  adding a second persistence implementation.
- Startup and active-project restore:
  `packages/app-host/src/project-manager.ts`,
  `packages/bridge-app/src/app-environment-host.ts`, and
  `apps/sim/src/services/sim-environment-store.ts`.
  Sim creates one IndexedDB store with `createIdbProjectStore(simName)`, passes
  the same namespace to `createWebLocksProjectLock(simName)`, constructs
  `ProjectManager`, and calls `AppEnvironmentHost.initialize`, which calls
  `ProjectManager.init()` followed by `ensureDefaultProject(defaultProjectName)`.
  The current active-project restore owner is `ProjectStore.getActiveProjectId`,
  which reads `${keyPrefix}:active-project` from `sessionStorage` first and
  then `localStorage`; W4 owns replacing this with the tab-scoped
  `${keyPrefix}:project-session` value:
  `{ projectCollectionId: string; activeProjectId?: string }`.
- `keyPrefix` scoping:
  `packages/app-host/src/project-store.ts`,
  `packages/app-host/src/idb-project-store.ts`,
  `packages/app-host/src/project-lock.ts`, and
  `apps/sim/src/services/sim-environment-store.ts`. `keyPrefix` is already the
  required app namespace for IndexedDB database names and Web Lock names. The
  current active-project storage keys are also derived from `keyPrefix`, but
  W4 replaces their shape and removes the `localStorage` active-project path.
  BroadcastChannel has no current implementation; W4 should introduce
  `${keyPrefix}:project-collections` as the app-scoped channel name.
- App-owned `localStorage` helpers:
  `apps/sim/src/services/sim-environment-store.ts`,
  `apps/sim/src/services/binding-token-persistence.ts`,
  `packages/bridge-app/src/app-environment-host.ts`, and
  `packages/bridge-app/src/user-tile-registration.ts`. UI preferences and
  collapsed archetype state are already scoped with `simName`, which is
  currently `@mindcraft-lang/sim`. App settings use `app-settings`, binding
  tokens use `bridge-binding-token`, and user-tile metadata uses
  `sim:user-tile-metadata`. These are app-owned browser-profile settings or
  caches, not project collection session state. The audit found a namespace
  contradiction, resolved by updating App Isolation and W4 to require
  app-owned localStorage keys to use the app namespace going forward. Existing
  values at old unscoped or differently scoped keys are abandoned.
- Bridge and export/import boundaries:
  `packages/app-host/src/project-io.ts`,
  `packages/app-host/src/project-io.spec.ts`,
  `packages/bridge-app/src/app-environment-host.ts`, and
  `apps/sim/src/services/sim-environment-store.ts`.
  Bridge payloads flow through project file snapshots and app-data access on
  `ProjectManager`; exported project JSON is built from manifest display
  fields, filtered project files, and app data. The audited path does not
  require adding `projectCollectionId` to bridge protocol messages,
  bridge-client snapshots, VS Code bridge messages, extension network payloads,
  or exported project JSON.
- Project metadata migration and default bootstrap:
  `packages/app-host/src/idb-project-store.ts`,
  `packages/app-host/src/project-store.ts`, and
  `packages/app-host/src/project-manager.spec.ts`. The current upgrade path
  already performs IndexedDB schema migration work, including the old
  `workspaces` store to `files` migration. W1/W2 can create
  `projectCollections`, create or read the
  `DEFAULT_PROJECT_COLLECTION_ID` record, and assign existing non-deleted
  project records to that ID in an upgrade path. Normal default bootstrap must
  use an `add`/duplicate-key reread pattern after DB open: if create loses a
  race, reread the existing non-deleted `DEFAULT_PROJECT_COLLECTION_ID` record
  and return it.
- Autosave and active project replacement:
  `packages/app-host/src/project-manager.ts`,
  `packages/bridge-app/src/app-environment-host.ts`, and
  `apps/sim/src/services/sim-environment-store.ts`. Project file autosave is
  scheduled by `ProjectManager.startAutoSave`; replacement and close already
  funnel through `closeInternal`, which stops the debounce timer, flushes the
  in-memory file system, saves the exported snapshot, and releases the project
  lock. `AppEnvironmentHost.beginProjectTransition` saves cached brains before
  create/switch, and sim reloads project app data on project load. Workspace
  switching should use the same flush/close path before replacing the active
  project context.
- Project locking:
  `packages/app-host/src/project-lock.ts`,
  `packages/app-host/src/project-manager.ts`, and
  `packages/app-host/src/project-manager.spec.ts`. Current project locks are
  app-scoped Web Locks named `${keyPrefix}:project:${projectId}:tab-lock`;
  `ProjectManager.tryOpen` acquires the target project lock before closing the
  current active project and leaves the current project open if acquisition
  fails. Project collection switching must preserve that same per-project lock
  behavior and must not introduce collection-level lock names.
- Write paths that need tombstone re-checks:
  `packages/app-host/src/idb-project-store.ts`,
  `packages/app-host/src/project-manager.ts`,
  `packages/bridge-app/src/app-environment-host.ts`, and
  `apps/sim/src/services/sim-environment-store.ts`. Guarded writes must cover
  project manifest updates, project creates, project tombstones, project
  duplication, project-file saves, app-data saves/deletes, import-created
  projects, active metadata updates, close-time project-file flushes,
  debounced autosave, cached brain saves, desired-count saves, and obstacle
  saves. Correctness comes from IndexedDB read-before-write checks against both
  project and project collection tombstones; BroadcastChannel is only the
  responsiveness mechanism.
- Project collection ownership decisions:
  `packages/app-host/src/project-store.ts`,
  `packages/app-host/src/idb-project-store.ts`,
  `packages/app-host/src/project-manager.ts`, and
  `packages/app-host/src/project-manager.spec.ts`. W1 owns project collection
  metadata CRUD, default bootstrap, duplicate-name allowance, and blocking
  deletion of `DEFAULT_PROJECT_COLLECTION_ID`. W2 owns project membership,
  project tombstones, and hiding tombstoned projects from public store APIs.
  W3 owns the active project collection context, blocking deletion of the
  active collection, manager-level collection switching, and hiding tombstoned
  records from manager APIs.

Follow-up spec edits made during W0:

- Updated App Isolation to record the current sim `keyPrefix` as
  `@mindcraft-lang/sim` and to treat all app-owned localStorage keys as
  namespace-scoped storage.
- Updated W4 deliverables and acceptance to require app settings, UI
  preferences, binding-token storage, and user-tile metadata cache keys to use
  the app namespace with no legacy key fallback.

No other storage/session contradictions were found. W1-W4 have named owners for
IndexedDB stores, tab session state, localStorage app state, Web Locks,
BroadcastChannel notifications, tombstone hiding, tombstone write guards, and
default project collection bootstrap.

## Phase W1 -- Project Collection Metadata Store

Purpose: add project collection persistence without changing visible app
behavior.

New/updated public app-host exports:

```ts
export const DEFAULT_PROJECT_COLLECTION_ID = "default";
export const DEFAULT_PROJECT_COLLECTION_NAME = "Default Workspace";

export interface ProjectCollection {
  projectCollectionId: string;
  name: string;
  deleted?: true;
  createdAt: number;
  updatedAt: number;
}
```

PIN protection fields are intentionally not part of W1. W6 adds
`pinVerifier?: ProjectCollectionPinVerifier` and the related behavior.

ProjectStore additions:

```ts
listProjectCollections(): Promise<ProjectCollection[]>;
getProjectCollection(projectCollectionId: string): Promise<ProjectCollection | undefined>;
createProjectCollection(name: string): Promise<ProjectCollection>;
updateProjectCollection(
  projectCollectionId: string,
  updates: Partial<Pick<ProjectCollection, "name">>
): Promise<void>;
deleteProjectCollection(projectCollectionId: string): Promise<void>;
ensureDefaultProjectCollection(): Promise<ProjectCollection>;
```

Public store methods return only non-deleted project collections. Use private
IndexedDB helpers for raw tombstoned records in migrations and tests.
`ensureDefaultProjectCollection()` returns the existing non-deleted collection
with `projectCollectionId === DEFAULT_PROJECT_COLLECTION_ID`, or creates a new
default collection when no such record exists. New default collection creation
must use
`DEFAULT_PROJECT_COLLECTION_ID` as the `projectCollectionId`. If creating the
default collection fails because another tab already inserted that key, reread
and return the existing non-deleted default collection.
`DEFAULT_PROJECT_COLLECTION_NAME` is used only as the initial name for a newly
created default collection. Store logic must never identify the default
collection by name.

Deliverables:

- Add `project-collection.ts` and export the new types/constants from
  `packages/app-host/src/index.ts`.
- Add project collection CRUD to `ProjectStore`.
- Update `idb-project-store.ts`:
  - Increment `DB_VERSION`.
  - Create `projectCollections` with key path `projectCollectionId`.
  - Add a non-deleted list helper used by `listProjectCollections`.
  - Implement `ensureDefaultProjectCollection`.
  - Implement collection tombstone by setting `deleted: true` and `updatedAt`.
- Create the bootstrap collection with `projectCollectionId:
DEFAULT_PROJECT_COLLECTION_ID`.
- Handle default bootstrap duplicate-key races by rereading the existing default
  collection.
- Reject `deleteProjectCollection` when `projectCollectionId ===
DEFAULT_PROJECT_COLLECTION_ID`.
- Do not add any unique index or uniqueness check for collection names.
- Bootstrap `Default Workspace` when no non-deleted project collection exists at
  `DEFAULT_PROJECT_COLLECTION_ID`.
- Add store tests for create/list/get/update/delete/bootstrap. These can be
  direct IndexedDB store tests or ProjectStore tests using the IDB store.
- Add a store test that creates two stores with different `keyPrefix` values and
  confirms each store sees only its own `DEFAULT_PROJECT_COLLECTION_ID` record.
- Search app-host docs/instructions for store-shape references and update stale
  references in the same phase.

Acceptance:

- Existing app behavior remains effectively single-collection.
- `Default Workspace` is created exactly when storage has no non-deleted
  project collection at `DEFAULT_PROJECT_COLLECTION_ID`.
- Concurrent default bootstrap attempts produce one default collection with
  `DEFAULT_PROJECT_COLLECTION_ID`.
- Project collection metadata round-trips through the IndexedDB store.
- Deleting a project collection sets `deleted: true` and excludes it from normal
  project collection lists.
- Deleting the default project collection is rejected based on
  `DEFAULT_PROJECT_COLLECTION_ID`, not based on the collection name.
- Creating or renaming collections to duplicate names is allowed.
- A non-default collection named `Default Workspace` does not count as the
  default collection.
- Renaming the default collection does not move default status to any other
  collection.
- Stores created with different `keyPrefix` values do not see each other's
  project collection records.
- `createdAt` and `updatedAt` are numeric timestamps.
- No PIN unlock behavior exists yet.
- No project schema or ProjectManager behavior changes ship in this phase.

Gate:

- `packages/app-host`: full gate.

## Phase W2 -- Project Collection Membership Migration

Purpose: make project persistence project-collection-owned.

ProjectStore signature changes:

```ts
listProjects(projectCollectionId: string): Promise<ProjectManifest[]>;
getProject(id: string): Promise<ProjectManifest | undefined>;
createProject(projectCollectionId: string, name: string): Promise<ProjectManifest>;
deleteProject(id: string): Promise<void>;
duplicateProject(id: string, newName: string): Promise<ProjectManifest>;
```

`listProjects` returns non-deleted projects only. `getProject` returns
`undefined` for tombstoned projects. `duplicateProject` copies within the source
project's collection in this phase; cross-collection copy is W7.
`createProject(projectCollectionId, name)` rejects when the target project
collection is missing or tombstoned.

`ProjectStore` is a low-level persistence surface. `ProjectManager` is the
app-facing active project collection boundary. App UI should call
`ProjectManager` for project lifecycle operations.

Store-level methods still enforce tombstone validity:

- `getProject(id)` returns `undefined` when the project is missing, tombstoned,
  or belongs to a missing or tombstoned project collection.
- `deleteProject(id)` rejects when the project is missing or belongs to a
  missing or tombstoned project collection. It is idempotent when the project
  record already has `deleted: true`. It does not check the caller's active
  project collection because `ProjectStore` has no active tab context.
- `duplicateProject(id, newName)` rejects when the source project is missing,
  tombstoned, or belongs to a missing or tombstoned project collection.
  Successful duplication creates the new project in the source project's
  collection.

ProjectManifest shape after migration:

```ts
interface ProjectManifest {
  id: string;
  projectCollectionId: string;
  name: string;
  description: string;
  thumbnailUrl?: string;
  deleted?: true;
  createdAt: number;
  updatedAt: number;
}
```

Deliverables:

- Add `projectCollectionId` to persisted project metadata.
- Migrate existing project metadata into `DEFAULT_PROJECT_COLLECTION_ID`.
- Add project-collection-scoped project listing/loading APIs or parameters.
- Ensure new projects are created in a project collection.
- Update `ProjectManager` minimally so existing single-collection behavior uses
  `ensureDefaultProjectCollection()` and passes that collection ID into
  `ProjectStore.createProject` and `ProjectStore.listProjects`.
- Add migration tests for old data.
- Change project delete behavior to set `deleted: true` on `ProjectManifest`
  instead of deleting the project record from IndexedDB.
- Preserve project files and app-data when a project is tombstoned.
- Add store tests for `getProject`, `deleteProject`, and `duplicateProject`
  when the project is missing, tombstoned, or belongs to a missing or tombstoned
  project collection, including idempotent `deleteProject` on an already
  tombstoned project.
- Update all app-host in-memory test stores in specs to implement the new
  ProjectStore contract.
- Update import/create-from-snapshot tests so imported projects receive the
  caller's active/default `projectCollectionId`.

Acceptance:

- Existing projects survive migration.
- Loaded project metadata always has `projectCollectionId`.
- Projects created after migration store the active/default
  `projectCollectionId`.
- Creating a project in a missing or tombstoned project collection fails without
  writing a project record.
- Deleted projects remain in IndexedDB with `deleted: true` and are excluded
  from normal project lists and open paths.
- `getProject` returns `undefined` for tombstoned projects and projects whose
  owning collection is missing or tombstoned through the public ProjectStore
  API.
- `deleteProject` is idempotent when the project is already tombstoned.
- `deleteProject` rejects when the project is missing or belongs to a missing
  or tombstoned project collection.
- `duplicateProject` rejects when the source project is missing, tombstoned, or
  belongs to a missing or tombstoned project collection.
- Deleting a project does not delete its files or app-data records.
- No project is orphaned after migration.
- Export JSON still does not include `projectCollectionId`.

Gate:

- `packages/app-host`: full gate.
- `apps/sim`: typecheck/check.

## Phase W3 -- ProjectManager Project Collection Context

Purpose: make project lifecycle project-collection-scoped internally.

ProjectManager state additions:

```ts
interface ActiveProjectCollection {
  readonly collection: ProjectCollection;
}
```

The implementation does not need to export `ActiveProjectCollection` if a plain
`activeProjectCollection: ProjectCollection | undefined` property is simpler.

ProjectManager behavioral contract:

- `init()` ensures a non-deleted active project collection exists before opening
  a project.
- `ensureDefaultProject(defaultName)` keeps its existing signature and creates
  or opens a project inside the active project collection.
- `listProjects()` lists projects in the active project collection only.
- `create(name)` creates in the active project collection and opens the new
  project.
- `createFromSnapshot(...)` creates in the active project collection without
  opening, matching current behavior.
- `createFromSnapshot(...)` rejects when the active project collection is
  missing or tombstoned.
- `open(id)` rejects if the project is deleted, missing, or belongs to another
  project collection.
- `delete(id)` is allowed only for non-active projects in the active project
  collection.
- `duplicate(id, newName)` duplicates only within the active project collection
  in this phase.
- Switching project collections flushes pending autosave, closes the active
  project, changes active collection, and opens/restores a project in the target
  collection if possible.
- `switchProjectCollection(projectCollectionId)` throws when the target project
  collection is missing or tombstoned.

Project collection state contract:

```ts
type ProjectCollectionAccessState = "ready" | "locked";

interface ProjectCollectionState {
  projectCollections: ProjectCollection[];
  activeProjectCollection?: ProjectCollection;
  activeProjectId?: string;
  access: ProjectCollectionAccessState;
}

interface ProjectCollectionSwitchResult {
  collection: ProjectCollection;
  access: ProjectCollectionAccessState;
}
```

W3 only produces `access: "ready"` in both `ProjectCollectionState` and
`ProjectCollectionSwitchResult` because PIN protection is introduced in W6. The
`locked` value is part of the shape now so workspace selector and app shell
wiring do not need a second state or switch-result model later.

`onProjectCollectionStateChange` does not replay current state. Callers that
need initial state must subscribe first, then call
`getProjectCollectionState()` once. Subscribing before the initial read avoids
missing a change between initial read and listener registration.
Calling `ProjectManager.init()` again does not clear, replace, or replay
`onProjectCollectionStateChange` listeners. Existing listeners remain attached
until their unsubscribe function is called.

New ProjectManager methods:

```ts
getProjectCollectionState(): Promise<ProjectCollectionState>;
onProjectCollectionStateChange(
  listener: (state: ProjectCollectionState) => void
): () => void;
listProjectCollections(): Promise<ProjectCollection[]>;
createProjectCollection(name: string): Promise<ProjectCollection>;
renameProjectCollection(projectCollectionId: string, name: string): Promise<void>;
switchProjectCollection(
  projectCollectionId: string
): Promise<ProjectCollectionSwitchResult>;
deleteProjectCollection(projectCollectionId: string): Promise<void>;
```

`deleteProjectCollection` throws when `projectCollectionId` is the active
collection in the current tab.
It also throws when the target collection has
`projectCollectionId === DEFAULT_PROJECT_COLLECTION_ID`.

Deliverables:

- `ProjectManager` owns or receives an active project collection context.
- Project listing, create, open, delete, duplicate, import, and export scope to
  the active project collection.
- Workspace switch flushes any pending autosave, closes the current project, and
  opens/restores a project in the target project collection.
- Cross-project-collection project access is rejected by normal active-project-
  collection APIs.
- Implement collection list/create/rename/switch/delete manager methods.
- Implement `getProjectCollectionState` and
  `onProjectCollectionStateChange`.
- Implement `switchProjectCollection` with the stable
  `ProjectCollectionSwitchResult` return shape.
- Document and test that project collection state subscriptions do not replay
  current state.
- Document and test that `ProjectManager.init()` reruns do not clear, replace,
  or replay existing project collection state listeners.
- Emit project collection state after init, create, rename, switch, delete,
  active project open, and active project close.
- Keep `AppEnvironmentHost.initialize(defaultProjectName)` callable with the
  same signature. Any internal adaptation must not change bridge payloads.
- Update sim startup only as needed to consume new manager state.

Acceptance:

- Project lists contain only active project collection projects.
- Opening a project from another project collection through active-project-
  collection APIs fails.
- Opening a tombstoned project or a project in a tombstoned project collection
  fails through normal APIs.
- `createFromSnapshot(...)` fails without writing a project record when the
  active project collection is missing or tombstoned.
- Current single-collection startup behavior remains unchanged.
- Autosave and project file persistence remain scoped to the active project.
- No manual save prompt or save action is introduced.
- Active collection delete is blocked.
- Default collection delete is blocked even when it is not active.
- Deleting a non-active collection tombstones the collection and its projects.
- Switching to a missing or tombstoned project collection fails without changing
  the active project collection.
- Switching to an empty collection creates or opens a default project according
  to the existing `ensureDefaultProject` behavior.
- W3 `switchProjectCollection` always returns `{ access: "ready" }`.
- UI-facing app state can be derived from `ProjectCollectionState` without
  reading storage directly.
- Initial UI state is obtained by subscribing, then calling
  `getProjectCollectionState()` once.

Gate:

- `packages/app-host`: full gate.
- `apps/sim`: typecheck/check.

## Phase W4 -- Multi-Tab And Tab Restore Semantics

Purpose: make multi-tab behavior and reload behavior correct before adding
visible workspace switching.

Session storage contract:

```ts
interface ProjectCollectionTabSession {
  projectCollectionId: string;
  activeProjectId?: string;
}
```

The serialized value is stored at `${keyPrefix}:project-session` in
`sessionStorage`. No active project or active collection ID is written to
`localStorage`.

ProjectStore session methods replace the active-project-only methods:

```ts
getProjectSession(): ProjectCollectionTabSession | undefined;
setProjectSession(session: ProjectCollectionTabSession | undefined): void;
```

Remove `getActiveProjectId` and `setActiveProjectId` from `ProjectStore` in the
same phase that updates all call sites.

BroadcastChannel wrapper location and contract:

- Define the wrapper in
  `packages/app-host/src/project-collection-broadcast.ts`.
- `ProjectManager` owns the wrapper instance and subscribes to it.
- `ProjectManager.dispose()` closes the wrapper subscription and channel. Owners
  of a `ProjectManager` instance must call `dispose()` when the manager leaves
  service; project-level `close()` does not release manager-level cross-tab
  resources.
- `ProjectStore` does not own BroadcastChannel behavior.
- App UI does not import or subscribe to this wrapper.
- Export from `project-collection-broadcast.ts` only.
- Do not add it to `packages/app-host/src/index.ts`.
- Tests import directly from `project-collection-broadcast.ts`.

```ts
type ProjectCollectionBroadcastMessage =
  | { type: "project-collection-tombstoned"; projectCollectionId: string }
  | { type: "project-tombstoned"; projectCollectionId: string; projectId: string };

interface ProjectCollectionBroadcast {
  post(message: ProjectCollectionBroadcastMessage): void;
  subscribe(listener: (message: ProjectCollectionBroadcastMessage) => void): () => void;
  close(): void;
}

function projectCollectionBroadcastChannelName(keyPrefix: string): string;

function createProjectCollectionBroadcast(keyPrefix: string): ProjectCollectionBroadcast;
```

`projectCollectionBroadcastChannelName(keyPrefix)` returns
`${keyPrefix}:project-collections`. When `BroadcastChannel` is unavailable, the
factory returns a no-op implementation whose `post`, `subscribe`, and `close`
methods are safe to call.

Deliverables:

- Store current tab `projectCollectionId` and active project ID in
  `sessionStorage`.
- Add `packages/app-host/src/project-collection-broadcast.ts` with the wrapper
  contract above.
- Send `project-collection-tombstoned` after collection tombstone and
  `project-tombstoned` after project tombstone.
- Subscribe ProjectManager to tombstone broadcasts and refresh or close active
  state when the message targets the active project or active project
  collection.
- Emit `ProjectCollectionState` after processing tombstone broadcasts and stale
  session fallback.
- Add `ProjectPersistenceError` and `ProjectManager.onProjectPersistenceError`
  as the app-facing attachment point for non-tombstone autosave failures.
- Keep `localStorage` as the owner for app settings, UI preference,
  binding-token, and user-tile metadata behavior, but use only app-namespaced
  keys for app-owned values. Do not read, write, migrate, or fall back to old
  unscoped or differently scoped keys.
- Reload reopens the same project collection/project in the same tab.
- New tabs do not inherit tab-scoped unlocked state.
- Add tests for reload restore, stale project collection/project IDs, and
  independent active project collection state across tabs.
- Add tests that workspace changes do not weaken existing project-level locking.
- Add tests that tombstone broadcasts close or replace active state in another
  manager instance.
- Add tests that BroadcastChannel messages from one `keyPrefix` are ignored by a
  manager using a different `keyPrefix`.
- Add tests that guarded write paths reject writes after project or collection
  tombstone even without a broadcast.
- Confirm reload restore does not depend on a manual save boundary.
- Remove the old active-project-only localStorage restore path.
- Add stale session fallback in `ProjectManager.init`:
  - Missing/deleted collection -> fall back to `Default Workspace`.
  - Missing/deleted/locked project -> open the first available project in the
    active collection or create the default project.

Acceptance:

- Reload restores current tab project collection/project.
- `ProjectManager.init` applies stale tab session fallback safely.
- New tab behavior is not treated as an unlock carry-forward path.
- Project collection switching in one tab does not switch another tab.
- Existing same-project multi-tab lock behavior is preserved.
- Recently autosaved project state is what reload restores.
- Tombstone broadcasts are used for prompt cross-tab UI/state updates.
- Tombstone broadcasts do not cross app namespaces.
- UI responsiveness to cross-tab tombstones comes through ProjectManager state
  subscriptions.
- Tombstone-driven state updates follow the same no-replay subscription
  semantics as W3.
- Guarded read-before-write checks prevent stale-tab writes even when
  BroadcastChannel is unavailable or missed.
- `localStorage` is no longer used for active project or active collection
  restore.
- App settings, UI preference, binding-token, and user-tile metadata
  localStorage behavior uses app-namespaced keys only, with old key data
  abandoned.
- `AppEnvironmentHost` and `SimEnvironmentStore` expose disposal paths that
  release the `ProjectManager` BroadcastChannel resources.

Gate:

- `packages/app-host`: full gate.
- `packages/bridge-app`: full gate.
- `apps/sim`: typecheck/check/build/test.

## Phase W5a -- Workspace UI Data APIs

Purpose: add the app-host data and notification surfaces that the workspace
selector and workspace-scoped project picker need, without implementing the
visible workspace selector UX yet.

W5a keeps project collections unprotected. It should not add PIN UI or bridge
protocol changes.

Workspace UI notification contract:

```ts
interface ProjectCollectionSummary {
  collection: ProjectCollection;
  projectCount: number;
}

interface ProjectCollectionSummarySubscription {
  initial: ProjectCollectionSummary[];
  unsubscribe: () => void;
}

interface ProjectListSubscription {
  initial: ProjectManifest[];
  unsubscribe: () => void;
}

interface ProjectCollectionStateSubscription {
  initial: ProjectCollectionState;
  unsubscribe: () => void;
}

interface ProjectCollectionProjectCommitResult {
  collection: ProjectCollection;
  project: ProjectManifest;
  access: "ready";
}

type ProjectCollectionSummaryChange =
  | { type: "upsert"; summary: ProjectCollectionSummary }
  | { type: "remove"; projectCollectionId: string };

type ProjectCollectionEvent =
  | { type: "project-collection-changed"; projectCollectionId: string }
  | { type: "project-collection-tombstoned"; projectCollectionId: string }
  | { type: "project-list-changed"; projectCollectionId: string }
  | { type: "project-tombstoned"; projectCollectionId: string; projectId: string };

onProjectCollectionEvent(
  listener: (event: ProjectCollectionEvent) => void
): () => void;
watchProjectCollectionState(
  listener: (state: ProjectCollectionState) => void
): Promise<ProjectCollectionStateSubscription>;
watchProjectCollectionSummaries(
  listener: (change: ProjectCollectionSummaryChange) => void
): Promise<ProjectCollectionSummarySubscription>;
listProjectsForCollection(projectCollectionId: string): Promise<ProjectManifest[]>;
watchProjectListForCollection(
  projectCollectionId: string,
  listener: (projects: ProjectManifest[]) => void
): Promise<ProjectListSubscription>;
switchProjectCollectionAndOpenProject(
  projectCollectionId: string,
  projectId: string
): Promise<ProjectCollectionProjectCommitResult>;
switchProjectCollectionAndCreateProject(
  projectCollectionId: string,
  name: string
): Promise<ProjectCollectionProjectCommitResult>;
```

`ProjectCollectionEvent` is the low-level app-host event stream for workspace UI
surfaces. It is emitted for local changes and for cross-tab broadcast messages.
The event stream does not replay previous events during subscription. Normal app
UI surfaces should prefer the derived state/list APIs below instead of
subscribing to `ProjectCollectionEvent` directly.
This is an in-process ProjectManager UI event stream fed by local manager
operations and the W4 `ProjectCollectionBroadcast` transport; it is not a second
cross-tab transport.

`project-collection-changed` is emitted after project collection create and
rename metadata changes. `project-collection-tombstoned` is emitted after local
or cross-tab collection tombstones. `project-list-changed` is emitted after
local project create, rename/update, delete, duplicate, import/create-from-
snapshot, or any other operation that changes the non-deleted project list for a
collection. `project-tombstoned` is emitted after local or cross-tab project
tombstones.

`watchProjectCollectionState` is the UI-facing watcher for committed workspace
and active project state. It wraps the W3 `getProjectCollectionState` plus
`onProjectCollectionStateChange` pair by registering for changes before reading
the initial state, then returning `{ initial, unsubscribe }`. W5a keeps the W3
APIs available, but W5b app UI must use this watcher instead of manually
combining the W3 get/on pair.

`watchProjectCollectionSummaries` is the only public workspace summary watcher.
It starts watching before reading the initial summary list and returns both the
initial non-deleted project collections plus project counts and the unsubscribe
function. It must not expose internal IDs as visible disambiguation.
W5a does not add a persisted project-count field, maintained counter, or
required `projectCollectionId` index. Implementations may derive the initial
summary list with one store-owned pass over non-deleted projects and group by
`projectCollectionId`. This one-pass initial derivation is the accepted W5a
cost.

`watchProjectCollectionSummaries` emits targeted patches, not a full summary
list. Project collection create, rename, and project-count changes call the
listener with `{ type: "upsert", summary }` for the affected collection only.
Project collection tombstones call the listener with
`{ type: "remove", projectCollectionId }`. The UI owns applying these patches
to the summary list returned in the watcher's `initial` value.
For project-count changes, recompute only the affected collection summary; do
not recompute all workspace summaries after every project create, delete,
duplicate, or import. Implementations may use a collection-scoped cursor or
index if a later phase introduces one, but W5a must not require schema work
just to populate selector counts.
W5a must not expose a public `getProjectCollectionSummaries` plus
`onProjectCollectionSummaryChange` pair in parallel with
`watchProjectCollectionSummaries`.

`listProjectsForCollection` returns non-deleted projects in the requested
non-deleted project collection without changing the active project collection.
It throws when the project collection is missing or tombstoned.

`watchProjectListForCollection` is the only public collection-scoped project
list watcher. It starts watching before reading the initial list and returns
both the initial project list and the unsubscribe function. It emits refreshed
project lists after `project-list-changed` and `project-tombstoned` events that
target the watched project collection. This notification path is separate from
the existing active-project collection `onProjectListChange` listener. Use it
instead of hand-rolling `fetch(); subscribe();` in component effects. W5a must
not expose a second public no-replay subscription shape for the same
collection-scoped project-list event stream.

`switchProjectCollectionAndOpenProject` and
`switchProjectCollectionAndCreateProject` are the atomic commit APIs for W5b's
pending workspace picker. They perform the autosave flush and active-project
close semantics of `switchProjectCollection`, but they must not restore an
existing project or create a default project as an intermediate step. On
success, they switch the active collection and open exactly the selected or
newly created project. On failure, the previously active collection/project
remain active. `switchProjectCollectionAndOpenProject` rejects when the target
collection is missing or tombstoned, when the project is missing or tombstoned,
or when the project does not belong to the target collection.
`switchProjectCollectionAndCreateProject` rejects without writing a project
record or changing active context when the target collection is missing or
tombstoned.

When a `project-collection-tombstoned` broadcast targets a subscribed project
collection, UI that is browsing that collection must cancel or close that browse
surface before stale project rows remain visible. W5b's pending workspace
selection rule owns the user-visible cancellation and feedback for the project
picker.

Canonical UI subscription mapping:

- Header committed workspace/project label and workspace selector trigger:
  use `watchProjectCollectionState`.
- Workspace selector dropdown list and secondary context: use
  `watchProjectCollectionSummaries`.
- Project picker project cards for the workspace being browsed: use
  `watchProjectListForCollection(projectCollectionId, listener)`.
- Pending workspace tombstone cancellation may observe
  `onProjectCollectionEvent`, but it must not also subscribe to summaries or
  collection state to drive the same cancellation path.
- Do not drive the same visual surface from more than one of these APIs. Derived
  APIs own React rendering; `ProjectCollectionEvent` exists to implement those
  derived APIs and narrow one-off reactions.

Deliverables:

- Add `ProjectCollectionEvent`, `onProjectCollectionEvent`,
  `ProjectCollectionStateSubscription`, `watchProjectCollectionState`,
  `ProjectCollectionProjectCommitResult`,
  `ProjectCollectionSummary`, `ProjectCollectionSummaryChange`,
  `ProjectCollectionSummarySubscription`, and
  `watchProjectCollectionSummaries`.
- Add `listProjectsForCollection` for one-shot collection-scoped project list
  reads.
- Add `watchProjectListForCollection` as the only public collection-scoped
  project list watcher, including its initial read and unsubscribe handle.
- Derive `ProjectCollectionSummary.projectCount` at read time without a
  persisted counter, and limit subsequent count refreshes to affected
  workspaces.
- Emit targeted summary patches after workspace rename, create, delete, project
  create, project delete, and cross-tab changes.
- Emit and consume collection-scoped project-list refreshes when
  `project-tombstoned` broadcasts target the workspace currently being browsed,
  including non-active workspaces.
- Add `switchProjectCollectionAndOpenProject` and
  `switchProjectCollectionAndCreateProject` for W5b pending workspace commits.
- Keep the canonical UI subscription mapping documented for W5b consumers.

Acceptance:

- Loading workspace summaries may scan live projects once to derive project
  counts, but a project create/delete/duplicate/import in one workspace emits
  one summary patch for that workspace and does not force a full summary-list
  recompute.
- `ProjectCollectionSummary` and `ProjectCollectionSummaryChange` are the
  canonical data contract for workspace selector rows and secondary context.
- `watchProjectCollectionState` starts watching before reading the initial
  committed workspace/project state and returns `{ initial, unsubscribe }`.
- W5b header and active-project UI must use `watchProjectCollectionState`
  rather than manually combining `getProjectCollectionState` and
  `onProjectCollectionStateChange`.
- `watchProjectCollectionSummaries` starts watching before reading the initial
  summary list and returns `{ initial, unsubscribe }`.
- `watchProjectCollectionSummaries` returns non-deleted collections with project
  counts in its initial value and does not expose internal IDs as visible
  disambiguation.
- W5a does not expose a public `getProjectCollectionSummaries` plus
  `onProjectCollectionSummaryChange` pair in parallel with
  `watchProjectCollectionSummaries`.
- Project collection create, rename, tombstone, and project-count changes emit
  targeted summary patches.
- `listProjectsForCollection` returns non-deleted projects for a non-active
  collection without changing active collection state.
- `watchProjectListForCollection` starts watching before reading the initial
  list and returns `{ initial, unsubscribe }`.
- W5a does not expose a public `onProjectListChangeForCollection` API in
  parallel with `watchProjectListForCollection`.
- `switchProjectCollectionAndOpenProject` switches to the target collection and
  opens the requested project without first restoring or creating another
  project in that collection.
- `switchProjectCollectionAndCreateProject` switches to the target collection
  and opens the new project without first restoring or creating another project
  in that collection.
- Pending commit API failures leave the previously active collection/project
  active.
- Collection-scoped project list notifications update when a project is created,
  renamed, deleted, duplicated, imported, or tombstoned in that collection.
- A project tombstoned in another tab is removed from a subscribed non-active
  collection list without requiring an active workspace switch.
- Header state, workspace selector rows, and project picker cards have distinct
  canonical ProjectManager data sources documented for W5b.
- `ProjectCollectionEvent` remains an in-process ProjectManager UI event stream
  fed by local manager operations and W4 broadcasts; it is not a second
  cross-tab transport.
- ProjectManager still rejects deleting the active collection, the default
  collection, and the last non-deleted collection while the W5a summary/event
  APIs are present.
- Deleted project collections disappear from summary snapshots and emit summary
  remove patches.
- W5a does not implement the visible workspace selector, row overflow menus, or
  pending project picker UX.
- No bridge protocol, bridge payload, or extension payload changes.

Gate:

- `packages/app-host`: full gate.
- `apps/sim`: typecheck/check/build only if touched.

## Phase W5b -- Workspace Selector and Pending Project Picker UX

Purpose: expose workspace management through the app header and route project
selection through the existing rich project picker while all project collections
remain unprotected.

W5b consumes the W5a UI data APIs. It should not add overlapping ProjectManager
notification surfaces.

Workspace and project UX model:

- Users experience the feature as two separate choices: first choose where to
  work, then choose what project to open there.
- "Workspace" is the only visible container term. Code that touches the
  app-host model still uses `ProjectCollection`.
- The UI does not mention Guest/User/Named workspace categories.
- Workspace selection is a lightweight dropdown from the app header, not a
  separate explorer dialog.
- The workspace selector manages workspaces only. It never shows project rows,
  project cards, thumbnails, GIFs, or project empty states.
- Project browsing remains in the project picker because projects use rich
  cards with thumbnails and future hover media.
- The project picker always names the workspace whose projects are being
  listed.
- The app header shows the committed active context as
  `<Workspace name> / <Project name>`.
- The workspace name is the workspace selector trigger. The project name remains
  a separate editable control.
- Editing the app header project name edits only the project name. Workspace
  renaming happens through the workspace selector actions.
- Header truncation prioritizes the project edit affordance: long workspace
  names truncate before the project name area shrinks below a reliable inline
  edit hit target.
- Truncated workspace names expose the full workspace name in a tooltip.

UI implementation convention:

- Use shared primitives from `@mindcraft-lang/ui` for buttons, dialogs, inputs,
  dropdown menus, cards, switches, sliders, and toasts.
- Do not add shadcn/ui primitives under `apps/sim/src`.
- If W5b needs a shadcn/ui primitive that does not exist yet, add it under
  `packages/ui/src/ui/`, export it from `packages/ui/src/ui/index.ts`, and use
  it from `apps/sim` through `@mindcraft-lang/ui`.
- Follow existing `packages/ui` conventions: source-only package, relative
  imports inside the package, `cn()` from `packages/ui/src/lib/utils`, no
  app-specific types, and matching Radix/shadcn wrapper style.

Entry points and naming:

- The app header workspace name opens the workspace selector dropdown.
- Keep the existing project browser entry point scoped to the currently active
  workspace.
- The project picker title should read as a workspace-scoped project browser,
  such as `Projects in <Workspace name>`.
- When the project picker opens for a pending workspace selection, its
  supporting text should make cancel behavior clear, for example `Choose a
  project to open this workspace, or close to stay in <Current workspace>.`
- The visible UI uses "Workspace" and "Default Workspace".

Workspace selector dropdown UX:

- The selector lists all non-deleted workspaces.
- Opening the selector must not block on summary storage I/O when the app has a
  last-known summary list. Render cached rows synchronously, then refresh
  summaries in the background through `watchProjectCollectionSummaries`.
- On a cold open with no cached summaries, open the dropdown immediately with a
  compact loading row, keep the `New Workspace` footer action available when
  possible, and replace the loading row when the summary read finishes.
- Each workspace item is a two-line menu item: workspace name on the first line
  and secondary context on the second line.
- Secondary context should use human-readable product context such as
  `Updated 2d ago`, `3 projects`, or `Created Jan 12`. It must not expose
  internal IDs.
- Secondary context must help distinguish duplicate workspace names. When names
  are duplicated, use the same distinguishing context in the project picker
  header.
- Mark the active workspace with a `Current` badge or checkmark.
- Mark the default workspace with a `Default` badge without relying on its
  display name.
- The primary action for a workspace item is to browse projects in that
  workspace.
- Choosing the already active workspace opens the project picker for the
  current workspace without creating a pending selection.
- The dropdown footer includes only `New Workspace`.
- Each workspace row has a secondary overflow menu with `Rename` and `Delete`.
  Opening this menu must not select or commit that workspace.
- Row overflow controls are visually secondary to workspace selection.
- Rename is lightweight, works for active and non-active workspaces, and keeps
  the user in the selector flow without requiring a workspace switch.
- Workspace rename opens from the row overflow menu as an inline edit or small
  popover anchored to that row. Enter commits, Escape cancels, and focus returns
  to the originating row action after close. Blur behavior should match the
  app's existing rename controls.
- Delete remains visible in the row overflow menu but disabled for the active
  workspace and the default workspace.
- Disabled row delete controls include a short reason in accessible text or a
  tooltip.
- Workspace deletion requires confirmation that says the workspace and its
  projects will disappear from normal lists.
- Clicking `New Workspace` opens a lightweight name prompt. Canceling that
  prompt creates no workspace and leaves the current workspace/project
  unchanged.
- Confirming the workspace name creates the workspace as a pending workspace and
  opens the project picker scoped to it. If the user closes that project picker
  before opening or creating a project, the app tombstones the newly created
  workspace and returns to the previously active workspace and project.

Project browsing flow:

- Selecting a different workspace from the workspace selector starts a pending
  workspace selection, closes the dropdown, and opens the project picker scoped
  to the selected workspace.
- The project picker lists only projects from the selected pending workspace.
- The project picker dialog header clearly shows the selected workspace name
  before the user chooses a project.
- While the project picker is open, its project list is subscribed to or
  refreshed for the workspace being browsed, even when that workspace is a
  pending non-active workspace.
- If another tab tombstones a project visible in the open project picker, the
  picker removes that project from the visible list without requiring the user
  to close and reopen the picker.
- Opening an existing project from that project picker commits the workspace
  selection and opens that exact project.
- Creating a project from that project picker commits the workspace selection
  and opens the new project in that workspace.
- Canceling the new-project dialog opened from a pending workspace returns to
  the workspace-scoped project picker and keeps the pending workspace selection
  uncommitted.
- Closing the project picker without opening or creating a project cancels the
  pending workspace selection and returns the app to the previously active
  workspace and project.
- When the pending workspace was just created by this flow, canceling the
  project picker tombstones that workspace before returning to the previous
  workspace and project.
- Existing project picker actions for project selection and creation operate
  inside the selected pending workspace.

Pending workspace selection semantics:

- The app records the previously active workspace and project before opening
  the project picker for a different workspace.
- While a different workspace is pending, the main app header, active workspace
  indicator, active project, and simulation continue to show the previously
  active workspace and project until the user opens or creates a project.
- The project picker is the only surface that shows the selected pending
  workspace before commit.
- Committing a pending workspace selection is atomic from the user's
  perspective.
- Opening an existing project in the picker commits the pending workspace
  selection and opens that exact project without first restoring or creating
  another project in that workspace.
- Creating a new project from the picker commits the pending workspace
  selection and opens the new project in that workspace without first restoring
  or creating another project in that workspace.
- W5b uses W5a's `switchProjectCollectionAndOpenProject` and
  `switchProjectCollectionAndCreateProject` APIs for these commit paths, not
  plain `switchProjectCollection`.
- Canceling the new-project dialog opened from a pending workspace keeps the
  project picker open for that workspace and does not commit the pending
  workspace selection.
- Closing the picker with Escape, the close button, backdrop dismissal, or any
  other non-selection close path cancels the pending workspace selection.
- If the pending workspace was created by the current `New Workspace` flow,
  canceling the picker tombstones that workspace.
- Canceling a pending workspace selection restores the previously active
  workspace and project with no visible header or active-workspace change left
  behind.
- Selecting the already active workspace opens the project picker scoped to the
  active workspace without creating a pending selection.
- Project deletion is disabled while the picker is showing a pending workspace.
  Project deletion remains available from normal project browsing after the
  workspace selection is committed.
- If the selected pending workspace has no projects, the project picker empty
  state names that workspace and offers a `New Project` action as the commit
  path.
- Browsing an empty pending workspace must not auto-create a default project.
  The only project creation path before commit is the user's `New Project`
  action from the picker.
- If the pending workspace has the same display name as another workspace, the
  project picker header includes the same secondary signal shown in the
  workspace selector so users can tell which workspace they are browsing.
- If a `project-collection-tombstoned` broadcast targets the pending workspace,
  the app cancels the pending workspace selection, closes the project picker,
  and restores the previously active workspace and project.
- When a pending workspace is canceled because it was removed in another tab,
  the app shows inline or toast feedback that the workspace was removed in
  another tab.

Workspace selector summary cache:

- The workspace selector owns an in-memory last-known summary cache for menu
  rendering.
- The header click path opens the dropdown from that cache without awaiting
  summary storage I/O.
- The selector starts or reuses `watchProjectCollectionSummaries` in component
  lifecycle code, seeds the cache from the watcher's `initial` value, and applies
  subsequent summary patches from the watcher listener.
- If no summary cache exists yet, the dropdown still opens immediately and shows
  a compact loading row until the initial summary read resolves.

Deliverables:

- Add header workspace selector dropdown.
- Add header layout constraints so the workspace selector truncates before the
  project-name edit target loses its usable hit area.
- Add per-row workspace overflow menus with rename/delete actions, and keep the
  dropdown footer scoped to `New Workspace`.
- Add the `New Workspace` name prompt and its cancel path before a workspace
  record is created.
- Use shared `@mindcraft-lang/ui` primitives for W5b UI, adding any missing
  shadcn/ui primitive to `packages/ui/src/ui/` rather than `apps/sim/src`.
- Show active/default workspace states.
- Wire workspace selector actions through ProjectManager methods from W3 and
  W5a.
- Use `watchProjectCollectionState` for active collection, collection list,
  active project, and access state.
- Cache last-known project collection summaries in the workspace selector so
  opening the header dropdown does not wait for async storage I/O.
- Use the active collection from `ProjectCollectionState` for the header
  workspace selector and workspace-name prefix.
- Keep workspace selector state watchers inside component lifecycles and
  do not create additional `ProjectManager` instances without wiring their
  owner disposal path.
- Use the canonical UI subscription mapping so the header, workspace selector,
  and project picker each have one primary ProjectManager data source.
- Refresh the project picker list and active project display after committing a
  pending workspace selection.
- Refresh the open project picker when project-list changes or
  `project-tombstoned` broadcasts target the workspace currently being browsed,
  including pending non-active workspaces.
- Open the project picker after a different workspace is selected from the
  workspace selector, using the selected workspace as a pending project
  collection.
- Commit pending workspace selections atomically so opening or creating a
  project from the picker cannot first restore or create an intermediate
  project in that workspace. Use W5a's
  `switchProjectCollectionAndOpenProject` and
  `switchProjectCollectionAndCreateProject` APIs for these commits.
- Cancel the pending workspace selection when the project picker closes without
  a project being opened or created.
- Tombstone a newly created pending workspace when its initial project picker is
  closed without opening or creating a project.
- Keep the pending workspace selection active when the new-project dialog is
  canceled from a pending workspace project picker.
- Add the selected workspace name to the project picker dialog header.
- Add project picker supporting text for pending workspace selection that makes
  cancel behavior clear.
- Add two-line workspace selector items with secondary context, and carry the
  same disambiguation into the project picker header when workspace names are
  duplicated.
- Use project collection summaries to keep workspace selector secondary context
  current after workspace rename, create, delete, project create, project
  delete, and cross-tab changes.
- Disable project deletion from the project picker while a different workspace
  is pending.
- Handle pending-workspace tombstone notifications by canceling the pending
  selection, closing the project picker, and showing removed-in-another-tab
  feedback.
- Ensure delete confirmation describes deleting the workspace and its projects
  from normal lists while preserving the underlying records.
- Verify keyboard navigation, visible focus, accessible names, and non-hover
  access to needed information in the workspace selector, row overflow menus,
  project picker, pending-state feedback, and header project-name edit control.
- Verify the header label/edit area, workspace selector dropdown, row overflow
  menus, and project picker at narrow and wide viewport sizes, with no text
  overlap, clipped controls, or lost primary actions.

Acceptance:

- Users can manage multiple unpinned project collections.
- Users can create or rename project collections with duplicate names.
- Duplicate workspace names remain distinguishable in the workspace selector
  and in the project picker header.
- Workspace selector items show the workspace name plus secondary context in a
  compact two-line menu item.
- Each workspace row exposes `Rename` and `Delete` from a secondary overflow
  menu. The dropdown footer exposes only `New Workspace`.
- Rename from a row overflow menu does not switch workspaces. Delete remains
  visible but disabled, with a reason, for active and default workspaces.
- Workspace rename from a row overflow menu supports keyboard commit/cancel
  behavior and returns focus to the originating row action after close.
- The workspace selector opens immediately on header click. With cached
  summaries it renders cached rows before the background refresh completes; with
  no cache it renders a compact loading row.
- Canceling the `New Workspace` name prompt creates no workspace.
- Confirming the `New Workspace` name opens the project picker for that new
  workspace; closing the picker without opening or creating a project tombstones
  the new workspace and returns to the previous active workspace and project.
- Opening a project from a pending workspace commits that workspace and opens
  the selected project through `switchProjectCollectionAndOpenProject` without
  first opening or restoring another project.
- Creating a project from a pending workspace commits that workspace and opens
  the new project through `switchProjectCollectionAndCreateProject` without
  auto-creating a default project first.
- Committing a pending workspace selection updates project list and active
  project collection context.
- Selecting a different workspace from the workspace selector opens the project
  picker scoped to that workspace.
- Closing that project picker without opening or creating a project returns the
  app to the workspace and project that were active before the selection.
- Canceling new-project creation from that picker returns to the same
  workspace-scoped picker without committing the workspace selection.
- The app header, active workspace indicator, active project, and simulation do
  not change while a different workspace is pending in the project picker.
- Selecting the already active workspace opens the project picker without
  creating cancelable pending state.
- The project picker dialog header shows the selected workspace name before the
  user selects a project.
- The project picker list updates when another tab tombstones a project in the
  workspace currently being browsed, including when that workspace is pending
  and not active.
- The project picker uses collection-scoped project list notifications rather
  than relying on active-workspace-only project list state while browsing a
  pending workspace.
- Project deletion is disabled in the project picker while a different
  workspace is pending.
- If another tab tombstones the pending workspace, the project picker closes,
  the pending selection is canceled, and the previous workspace/project remains
  active.
- When a pending workspace is removed in another tab, the user sees inline or
  toast feedback explaining that the workspace was removed.
- The project picker empty state names the selected workspace and offers a `New
  Project` action when that workspace has no projects.
- Browsing an empty pending workspace does not auto-create a default project.
- The workspace selector never displays project rows, project cards, thumbnails,
  GIFs, or a project-empty state for a workspace.
- The workspace selector updates from ProjectManager state notifications after
  create, rename, selection commit, delete, and active project changes.
- Workspace selector secondary context updates after project count changes and
  cross-tab workspace/project changes.
- Cross-tab project collection create, rename, and tombstone events refresh the
  workspace selector without requiring the user to close and reopen it.
- Header state, workspace selector rows, and project picker cards are each
  driven by their canonical ProjectManager subscription without duplicate
  subscriptions for the same rendered data.
- The app header updates its `<Workspace name> / <Project name>` label after
  workspace selection commit, workspace rename, and project rename.
- Long workspace names truncate before the project-name edit area, and the
  project-name edit target remains reliably clickable/editable.
- Truncated workspace names show the full workspace name in a tooltip.
- Accessibility pass: the workspace selector, row overflow menus, project
  picker, pending-state feedback, and header project-name edit control are
  keyboard reachable, have visible focus states, expose meaningful accessible
  names, and do not rely on hover-only information.
- Responsiveness pass: the header label/edit area, workspace selector dropdown,
  row overflow menus, and project picker remain usable without text overlap,
  clipped controls, or lost primary actions on narrow and wide viewports.
- Editing the app header project label changes only the project name and does
  not edit, trim, validate, or submit the workspace name.
- Row overflow delete controls remain visible but disabled for active and
  default collections.
- Deleting the last non-deleted project collection remains blocked by the active
  collection and default collection delete rules.
- Deleted project collections disappear from normal workspace selector lists.
- UI does not mention Guest/User/Named workspace categories.
- No PIN UI exists in this phase.
- No bridge protocol, bridge payload, or extension payload changes.

Gate:

- `apps/sim`: typecheck/check/build.
- `packages/app-host`: relevant gates if touched.

## Phase W6 -- Optional PIN Protection

Purpose: add protection as a project collection property, not a workspace kind.

PIN verifier contract:

- Store `ProjectCollection.pinVerifier` directly on the collection record.
- Clearing `pinVerifier` removes protection.
- Passing `pinVerifier: undefined` to `updateProjectCollection` clears the
  verifier.
- Omitting `pinVerifier` from `updateProjectCollection` updates leaves the
  existing verifier unchanged.
- Raw PIN is never stored.
- Treat the user-entered PIN as a string, not a number.
- Trim leading and trailing whitespace before validation and verification.
- The trimmed PIN string is UTF-8 encoded and passed to PBKDF2.
- Valid PIN length after trim is 4 to 128 characters.
- Allow printable ASCII, including internal spaces.
- Reject empty strings, strings shorter than 4 characters, strings longer than
  128 characters, and strings containing control characters.
- Do not enforce character-class complexity rules.
- Store a verifier `scheme`, salt, hash, and creation timestamp.
- Use `scheme: "v1"` for the first verifier scheme.
- `v1` uses WebCrypto PBKDF2 with SHA-256.
- `v1` constants:
  - `PIN_PBKDF2_ITERATIONS = 150_000`
  - `PIN_SALT_BYTES = 16`
  - `PIN_HASH_BYTES = 32`
- Store salt/hash as base64 strings.
- Do not store per-record algorithm or iteration fields.
- Do not add `credentialVersion`.
- Do not implement a JavaScript crypto fallback. If WebCrypto PBKDF2 is
  unavailable, PIN setup and unlock fail with a clear capability error.
- A future verifier scheme is added by extending
  `ProjectCollectionPinVerifier.scheme` with a new literal, such as `"v2"`.
- Existing `"v1"` records are not silently re-hashed. A re-hash happens only on
  the next successful PIN change.

```ts
interface ProjectCollectionPinVerifier {
  scheme: "v1";
  salt: string;
  hash: string;
  createdAt: number;
}

interface ProjectCollection {
  pinVerifier?: ProjectCollectionPinVerifier;
}
```

Unlock/session contract:

- In-memory unlocked state is per tab.
- A protected collection is locked in a new tab.
- App-host unlock APIs may accept a raw PIN as input data for verification, but
  app-host never prompts for PIN entry and never depends on UI access.
- `switchProjectCollection(projectCollectionId)` does not accept a PIN, a PIN
  verifier, or any UI callback.
- Switching to a protected locked collection is allowed. It makes that
  collection active in the current tab, closes the active project, and returns a
  locked state without opening, listing, editing, deleting, exporting, or
  importing projects in that collection.
- A separate unlock API verifies the PIN and marks the collection unlocked in
  memory for the current tab.
- If the target collection becomes tombstoned during unlock verification,
  `unlockProjectCollection` rejects and does not record unlock state.
- On successful unlock, if the unlocked collection equals the current tab
  session's `projectCollectionId`, write a fresh
  `ProjectCollectionReloadUnlock` to `sessionStorage` with
  `expiresAt = Date.now() + RELOAD_UNLOCK_TTL_MS`.
- On successful unlock of a non-active collection, do not write a reload unlock
  record.
- If the unlocked collection is the active collection, unlock restores or opens
  the intended project using the same fallback rules as reload restore.
- A protected collection may be restored after reload only through a
  short-lived sessionStorage reload unlock record.
- The reload unlock record shape is:

```ts
interface ProjectCollectionReloadUnlock {
  projectCollectionId: string;
  expiresAt: number;
}
```

- The reload unlock record is not signed or MACed.
- Validate reload unlock by checking that the collection still exists, is not
  deleted, still has `pinVerifier`, matches the tab session
  `projectCollectionId`, and has `expiresAt > Date.now()`.
- If reload unlock validation fails, require the PIN again.
- Use `RELOAD_UNLOCK_TTL_MS = 30 * 60 * 1000`.
- `lockProjectCollection(projectCollectionId)` clears the in-memory unlock state
  and removes any reload unlock record for that collection from
  `sessionStorage`.

ProjectManager PIN API additions:

```ts
interface ProjectCollectionUnlockResult {
  collection: ProjectCollection;
  access: "ready";
}

unlockProjectCollection(
  projectCollectionId: string,
  pin: string
): Promise<ProjectCollectionUnlockResult>;
lockProjectCollection(projectCollectionId: string): void;
isProjectCollectionUnlocked(projectCollectionId: string): boolean;
```

`switchProjectCollection` returns `{ access: "locked" }` only when the target
collection exists, is non-deleted, is protected, and is not unlocked in the
current tab. Missing collections, tombstoned collections, and failed project
restores still use the existing error/fallback behavior.

Deliverables:

- Add `ProjectCollectionPinVerifier` and add
  `pinVerifier?: ProjectCollectionPinVerifier` to `ProjectCollection`.
- Expand `updateProjectCollection` so W6 code can set or clear `pinVerifier`:

```ts
updateProjectCollection(
  projectCollectionId: string,
  updates: Partial<Pick<ProjectCollection, "name" | "pinVerifier">>
): Promise<void>;
```

- Store verifier, never raw PIN.
- Add shared PIN validation used by set/change PIN and unlock flows.
- Add shared verifier helpers for `scheme: "v1"` using the W6 constants.
- Treat missing or cleared `pinVerifier` fields as unprotected project
  collections.
- Add per-workspace PIN controls in the workspace selector for set/change/remove
  PIN.
- Add locked/unlocked state in memory.
- Require unlock before opening, editing, or deleting from a protected project
  collection.
- `deleteProjectCollection` rejects when the target collection is protected and
  not unlocked in the current tab.
- Require the collection to be unlocked before changing or removing its PIN.
- Add `unlockProjectCollection`, `lockProjectCollection`, and
  `isProjectCollectionUnlocked` APIs.
- Update `switchProjectCollection` so its existing
  `ProjectCollectionSwitchResult` can return `access: "locked"`.
- Update `switchProjectCollectionAndOpenProject` and
  `switchProjectCollectionAndCreateProject` to reject without opening, creating,
  or switching when the target collection is protected and locked.
- Emit `ProjectCollectionState` after switch, unlock, lock, reload unlock
  restore, verifier set, verifier change, and verifier removal.
- On `switchProjectCollection`, perform autosave flush and active-project close
  before locking the previous protected collection.
- Lock previous protected project collection on workspace switch.
- Lock-on-switch clears the previous active collection's in-memory unlock state
  and removes the matching reload unlock record from `sessionStorage`.
- Add short-lived reload unlock records in `sessionStorage`.
- Add tests for verifier behavior, unlock state, reload unlock expiry,
  collection mismatch, deleted collection, removed verifier, and new-tab
  behavior.
- Add a test that lock-on-switch clears the previous active collection's
  in-memory unlock state and removes the matching reload unlock record.
- Add a test that `lockProjectCollection` removes the matching reload unlock
  record from `sessionStorage`.
- Add a test that successful `unlockProjectCollection` writes a fresh reload
  unlock record to `sessionStorage` only when the unlocked collection matches
  the current tab session collection.
- Add a test that successful unlock of a non-active collection does not write a
  reload unlock record.
- Add a test where the collection is tombstoned while
  `unlockProjectCollection` is awaiting verifier work.
- Add tests for unsupported WebCrypto capability handling.
- Do not add PIN controls to App Settings in this phase.
- Gate project open/edit/delete/import-target actions behind unlock when the
  target collection is protected.
- Do not gate project collection switch behind unlock; switch can produce a
  locked active collection state.

Acceptance:

- Unpinned project collections remain frictionless.
- PIN values are strings, so numeric-looking PINs and memorable phrases are both
  valid when they pass the shared validation rules.
- The workspace selector is the canonical UI surface for set/change/remove PIN.
- Removing the verifier removes protection without making projects inaccessible.
- Protected project collection reload works inside the reload unlock record TTL.
- Expired reload unlock records require PIN entry again.
- Reload unlock for a different collection is ignored.
- Reload unlock is ignored when the collection is deleted or no longer has a
  verifier.
- New tab starts locked for protected project collections.
- Switching away locks protected project collection state.
- Lock-on-switch clears both in-memory unlock state and the matching reload
  unlock record for the previous active collection.
- Locking a project collection clears both in-memory unlock state and the
  matching reload unlock record.
- Switching to a protected locked collection succeeds and returns locked state
  without opening a project.
- Atomic pending-commit APIs reject against a protected locked collection and
  leave the previous active collection/project unchanged.
- Unlocking the active protected collection restores or opens a project.
- Successful unlock writes a fresh reload unlock record only for the current tab
  session collection.
- Invalid PIN leaves unlock state unchanged.
- If the collection is tombstoned during unlock verification, unlock state is
  unchanged.
- Unlock attempts are not rate-limited.
- UI can render locked, ready, and unlock-failed states from method results and
  ProjectManager state notifications without app-host owning any UI prompt.
- Clearing `pinVerifier` immediately makes the collection unprotected.
- Changing or removing a PIN requires the collection to already be unlocked.
- Deleting a protected non-active collection requires that collection to be
  unlocked first.
- PIN protection does not encrypt IndexedDB project data.

Gate:

- `packages/app-host`: full gate.
- `apps/sim`: typecheck/check/build.

## Phase W7 -- Cross-Project-Collection Copy, Import, And Export Hygiene

Purpose: make ownership transfer and local-only metadata boundaries explicit.

API contract:

- `importProject` refers to the existing app-host export from
  `packages/app-host/src/project-io.ts`.
- `importProject(...)` creates by calling `ProjectManager.createFromSnapshot`,
  so project collection ownership is enforced by the manager and not by parsing
  `projectCollectionId` from the imported file.
- `ProjectManager.createFromSnapshot` creates in the active unlocked project
  collection.
- `ProjectManager.createFromSnapshot` rejects when the active project
  collection is missing, tombstoned, or locked.
- `importProject(...)` rejects when the active project collection is missing,
  tombstoned, or locked.
- `duplicate(id, newName)` remains same-collection duplication.
- Add an explicit cross-collection copy/remix API rather than overloading
  duplicate:

```ts
copyProjectToCollection(
  sourceProjectId: string,
  targetProjectCollectionId: string,
  newName: string
): Promise<ProjectManifest>;
```

`copyProjectToCollection` rejects when the source project is missing or
tombstoned. It rejects when the source collection is missing, tombstoned, or
locked when protected. It rejects when the target collection is missing,
tombstoned, or locked when protected.

The copy API copies project manifest display fields, project files, and allowed
app-data. It does not copy `projectCollectionId`, `deleted`, or session state.

Deliverables:

- Update `packages/app-host/src/project-io.ts` only as needed so
  `importProject` continues to delegate ownership to
  `ProjectManager.createFromSnapshot`.
- Import creates a project in the active unlocked project collection.
- Imported project names do not need to be unique.
- Duplicate within a project collection copies full project content.
- Implement `ProjectManager.copyProjectToCollection(sourceProjectId,
targetProjectCollectionId, newName)`.
- Copy/remix to another project collection copies project content only.
- Export is allowed only for the active unlocked project collection.
- Exclude `projectCollectionId` from exported project JSON.
- Require the source collection to be unlocked when it is protected.
- Require the target collection to be unlocked when it is protected.
- Add export test that asserts the serialized project document has no
  `projectCollectionId`.
- Add export test that a locked active project collection cannot export.
- Add import test that asserts imported projects receive the active collection
  ID, not an ID from the file.
- Add import and `createFromSnapshot` tests for missing active collection,
  tombstoned active collection, and locked active collection.
- Add copy/remix tests for source locked, target locked, source deleted, target
  deleted, source collection missing/tombstoned, target collection
  missing/tombstoned, and local metadata exclusion.

Acceptance:

- No project moves silently between project collections.
- Cross-project-collection copy/remix never copies local ownership metadata.
- Exported project JSON does not contain `projectCollectionId`.
- Export from a protected locked project collection is rejected.
- `ProjectManager.createFromSnapshot` rejects without writing a project record
  when the active project collection is missing, tombstoned, or locked.
- `importProject` rejects without writing a project record when the active
  project collection is missing, tombstoned, or locked.
- `ProjectManager.copyProjectToCollection` rejects without writing a project
  record when the source project is missing or tombstoned, the source collection
  is missing/tombstoned/locked when protected, or the target collection is
  missing/tombstoned/locked when protected.
- Imported project JSON cannot force a target `projectCollectionId`.
- Importing a project with a duplicate name is allowed.
- Same-collection duplicate remains unchanged except for ownership metadata
  staying in the same collection.
- Protected target project collection must be unlocked to receive
  copied/imported project content.

Gate:

- `packages/app-host`: full gate.
- `apps/sim`: relevant gates.

## Phase W8 -- Lock-In And Cleanup

Purpose: catch integration drift after W1-W7 without re-auditing decisions that
are already owned by W0 and phase-level gates.

This phase is not where core multi-tab, delete, project collection, tombstone,
or export behavior is introduced. It is a thin final check that no new
workspace-adjacent names, storage keys, public exports, or protocol surfaces
escaped the phase that should have owned them.

Deliverables:

- Remove remaining Guest/User/Named workspace terminology.
- Confirm no `WorkspaceKind` or equivalent category flag exists.
- Audit only storage and coordination keys added after W0. Confirm each key
  that can coexist with another app on the same origin follows the W0 app
  namespace policy.
- Polish workspace selector empty states and destructive confirmations.
- Document the final workspace UI and `ProjectCollection` internal model in the
  appropriate product/spec docs.
- Audit package exports to confirm app-host exposes only the intended workspace
  API surface.
- Audit bridge-protocol, bridge-client, bridge-app payload types, VS Code
  bridge messages, and extension network payloads for no workspace changes.

Acceptance:

- Project collection model is stable enough for follow-on features.
- All changed package gates are green.
- No storage or coordination key added after W0 bypasses the app namespace
  policy.
- No implementation phase left "temporary" aliases, wrappers, or compatibility
  paths for old unscoped project APIs.

Gate:

- Full relevant gates for every touched package.
