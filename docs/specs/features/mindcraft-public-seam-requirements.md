# Mindcraft Public Seam Requirements

Derived from:
- [mindcraft-seam-design.md](mindcraft-seam-design.md)
- [mindcraft-public-seam-phased-impl.md](mindcraft-public-seam-phased-impl.md)

Date: 2026-04-04

Requirement numbering convention:

- New inserted requirements may use fractional IDs to avoid renumbering the
   rest of the document, for example `FR-2.5`, `NFR-3.5`, or `INV-1.5`.
- Existing requirement IDs remain stable unless there is a specific reason to
   renumber the document.

## Problem Statement

The current Mindcraft integration story is functionally workable but inadequate
as a public seam.

- Runtime integration depends on process-global mutable state and low-level
  registries, which makes the normal app path harder to understand, harder to
  compose, and harder to isolate.
- Bridge integration exposes low-level transport concepts and mixes connection
  lifecycle, workspace synchronization, diagnostics, and optional compilation in
  a way that forces apps to understand internals they should not need.
- Apps that use user-authored tiles must currently manage semantic metadata,
  compiled artifacts, revision tracking, and startup bootstrapping across
  several separate hooks and caches instead of through one coherent extension
  boundary.
- Persisted brains depend on semantic tile metadata being available before fresh
  compiler output arrives, but that behavior is not expressed as a clear,
  supported product requirement.
- The seam must remain valid for the hardest compatibility target, including
  Roblox-oriented consumers, while still being clean for browser and node apps.

This matters because new apps should be able to adopt Mindcraft in clear,
independent tiers without depending on hidden globals, deep imports, transport
internals, or app-owned runtime bookkeeping that the platform itself should own.

## Functional Requirements

## Adoption Tiers And Public Integration

### FR-1 Runtime-only adoption

Requirement: The system must let an app use Mindcraft runtime features without
enabling user-authored tile compilation or bridge connectivity.

Acceptance criteria:
1. A new app can create, initialize/start, tick, and page-control brains
   through the recommended public seam without configuring compiler behavior or
   bridge behavior.
2. Runtime-only adoption does not require access to process-global registries,
   transport/session objects, or compiler-specific inputs.
3. The app can inspect the runnable brain it created through the supported
   seam, including executable-program state, compiled-program state, page
   state, scheduler state, and execution context, without downcasting to a
   concrete runtime class.

### FR-2 Runtime plus compiler adoption

Requirement: The system must let an app add user-authored tile compilation
without also requiring bridge connectivity.

Acceptance criteria:
1. An app can compile user-authored tiles and apply the resulting semantic and
   executable updates without establishing bridge connectivity.
2. Normal runtime consumption of compiler output does not require app-owned side
   maps for primary action artifacts or semantic tile registries.

### FR-3 Bridge-only adoption

Requirement: The system must let an app add bridge connectivity and workspace
synchronization without also requiring compiler-specific features.

Acceptance criteria:
1. An app can connect, synchronize workspace content, and observe connection
   state without configuring diagnostics or compilation behavior.
2. Plain bridge connectivity does not require compiler inputs, compiler status
   publishing, or ambient-declaration customization.

### FR-4 Full-stack adoption

Requirement: The system must let an app combine runtime features,
user-authored tile compilation, and bridge connectivity as one composed flow.

Acceptance criteria:
1. An app can consume compiler output for runtime behavior while also using the
   bridge for workspace synchronization and diagnostics publication.
2. The combined flow does not require the app to reach through to low-level
   runtime or transport internals.

### FR-5 Public integration boundary

Requirement: The recommended app-facing path must not require apps to depend on
hidden registries, concrete runtime classes, low-level transport objects, or
deep implementation imports.

Acceptance criteria:
1. A new app can follow the recommended path without calling legacy global
   registration helpers or reaching into transport/session internals.
2. Advanced or low-level APIs may remain available, but they are not required
   for the normal integration path.
3. A module can register runtime-callable functions that are distinct from
   operators and tile-backed sensors/actuators through the supported extension
   seam rather than reaching into a hidden function registry.

## Runtime Scope, Semantics, And Brain Lifecycle

### FR-6 Runtime isolation

Requirement: The system must allow multiple independent runtime contexts to
coexist without leaking types, tiles, actions, operators, or invalidation state
between them.

Acceptance criteria:
1. Creating two runtime contexts in the same process does not cause semantic or
   executable registrations from one context to appear in the other.
2. Updating compiler output in one context does not invalidate or rebuild brains
   owned by another context.

### FR-7 Distinct semantic tile scopes

Requirement: The system must support distinct environment-wide tiles,
app-provided overlay tiles, and per-brain local tiles.

Acceptance criteria:
1. Tiles intended to be globally visible within one runtime context are visible
   to all brains in that context.
2. App-provided overlay tiles affect only the brains to which the app supplies
   them.
3. Per-brain local tiles are available to that brain automatically and do not
   need to be resupplied separately by callers.

### FR-8 Effective tile visibility during load and link

Requirement: When a brain is created, linked, or deserialized, the system must
resolve semantic tiles using the full effective set of shared, hydrated,
compiled, overlay, and brain-local tile metadata.

Acceptance criteria:
1. Persisted-brain loading can resolve previously authored tile IDs when the
   required semantic metadata is available from the supported sources.
2. Brain-local tiles remain available even when no app overlay tiles are
   provided.

### FR-9 Persisted-brain startup hydration

Requirement: The system must let persisted brains deserialize before fresh
compiler output is available, using cached semantic tile metadata from a prior
successful compile.

Acceptance criteria:
1. On cold startup, persisted brains can load successfully when cached semantic
   tile metadata exists but fresh compilation has not completed yet.
2. The system continues to support editor and tooling surfaces that depend on
   semantic tile metadata before fresh compilation finishes.

### FR-10 Hydration semantics versus executable actions

Requirement: Cached startup tile metadata must enable semantic loading and
tooling before compile completion, but it must not be treated as executable
user-authored action behavior.

Acceptance criteria:
1. A cold-start brain can deserialize and display semantic information from
   cached metadata before fresh compile output exists.
2. The system does not treat cached semantic metadata by itself as proof that
   executable user-authored actions are available.

### FR-11 Compiler output consumption

Requirement: The system must accept fresh compiler output as the authoritative
source of user-authored semantic tile definitions and executable action
implementations.

Acceptance criteria:
1. After a successful compile, fresh semantic tile metadata replaces the older
   fallback metadata rather than coexisting with it indefinitely.
2. Runtime behavior uses the fresh executable action implementations associated
   with the latest successful compile output.
3. The first successful bundle install after startup hydration atomically
   removes the entire hydrated fallback snapshot and installs fresh bundle tile
   metadata.
4. A hydrated fallback tile that does not appear in the fresh bundle is no
   longer visible after that atomic handoff.
5. The handoff does not leave stale hydrated metadata able to shadow fresh
   bundle metadata under normal tile lookup.
6. Each successful bundle emission includes the complete current authored tile
   set for the bundle-managed domain rather than only tiles for recently
   changed authored actions.
7. Shared semantic tiles, such as parameter tiles reused by multiple authored
   actions, remain present across bundle replacement even when only one of the
   dependent authored actions changed.

### FR-12 Selective invalidation

Requirement: When authored actions change or are removed, the system must
invalidate only the brains affected by those changes.

Acceptance criteria:
1. Brains that do not depend on changed or removed authored actions remain
   active.
2. Brains that do depend on changed or removed authored actions become
   invalidated and are identifiable to the app.

### FR-13 App-controlled rebuild timing

Requirement: When brains are invalidated, the system must let the app decide
when rebuild work occurs.

Acceptance criteria:
1. The app can rebuild invalidated brains immediately or at a deferred boundary
   such as the next frame.
2. Applying fresh compiler output does not force immediate rebuild work before
   the app chooses to run it.

### FR-14 Stable brain handle and explicit disposal

Requirement: The system must preserve a stable app-facing brain handle across
rebuilds and must stop tracking a brain after explicit disposal.

Acceptance criteria:
1. Rebuilding a brain does not require the app to replace its stored brain
   handle/controller.
2. Once a brain is disposed, later authored-action updates do not keep
   invalidating or rebuilding it.
3. The stable brain handle continues to expose the runnable brain surface
   across rebuilds, so the app does not need a separate hidden runtime
   reference after rebuild.

### FR-15 Reusable definitions and independent instances

Requirement: The system must allow many independent runnable brains to be
created from the same authored brain definition.

Acceptance criteria:
1. Repeated creation from one shared brain definition produces distinct
   runnable brains rather than one shared runtime instance.
2. Brains created from the same definition do not share variables, page state,
   scheduler state, execution-context state, or invalidation bookkeeping.
3. Replacing or editing the definition an app wants to use for future runtime
   instances does not silently merge or overwrite the runtime state of existing
   live brains.

## Presentation And Semantic Separation

### FR-16 Presentation independence

Requirement: The system must separate semantic tile behavior from tile
presentation.

Acceptance criteria:
1. Runtime semantics remain usable without configuring tile presentation.
2. Presentation choices do not alter semantic linking, deserialization, or
   executable action behavior.

### FR-17 Presentation isolation

Requirement: Presentation state in one app or runtime context must not leak
into another app or runtime context.

Acceptance criteria:
1. Changing tile presentation in one context does not change tile presentation
   or runtime semantics in another context.
2. Cross-app global presentation state is not required for normal integration.

## Bridge Connectivity And Workspace Ownership

### FR-18 Bridge lifecycle surface

Requirement: The system must expose bridge connection lifecycle state, join
code, and workspace synchronization through an app-facing surface that does not
require low-level transport access.

Acceptance criteria:
1. An app can start and stop bridge connectivity, request synchronization, and
   observe connection state through the supported public seam.
2. The app can obtain join-code visibility through the supported public seam
   without inspecting low-level session objects.

### FR-19 Remote and local workspace change flow

Requirement: The system must let apps observe remote workspace changes and
apply local workspace changes through the supported bridge seam.

Acceptance criteria:
1. Bridge-originated workspace changes are observable through the public seam.
2. App-owned workspace state can be updated in response to remote changes
   without reach-through into transport internals.

### FR-20 App-owned workspace persistence

Requirement: User-authored workspace state must remain app-owned and
persistable independently of bridge internals.

Acceptance criteria:
1. The app can persist the authoritative user-authored workspace snapshot
   without exporting a bridge-owned raw virtual filesystem.
2. Generated compiler-only inputs are not treated as part of the user-authored
   workspace snapshot that the app persists.

### FR-21 Batched full-sync persistence

Requirement: When a full import or full synchronization updates many workspace
files at once, the system must support persisting the result as one batched
snapshot write.

Acceptance criteria:
1. Full import/full sync does not require one persistence write per file.
2. The final persisted snapshot matches the post-sync user-authored workspace
   state.

### FR-22 Optional bridge feature boundary

Requirement: Optional bridge features must be able to operate entirely through
the public bridge feature capability surface.

Acceptance criteria:
1. A feature that publishes diagnostics or status can attach and operate
   without direct access to low-level transport/session objects.
2. Bridge features can observe connection changes, remote changes, and sync
   completion through the supported public seam alone.

## Compilation, Diagnostics, And Compiler-owned Inputs

### FR-23 Diagnostics and compile-status publication

Requirement: Bridge-connected apps that opt into compilation must be able to
publish diagnostics and compile status through the supported public seam.

Acceptance criteria:
1. Diagnostics can be published after compile results are available without a
   direct low-level session sender.
2. Compile status updates can be published through the same supported seam.

### FR-24 Diagnostic replay after pairing or full sync

Requirement: When cached diagnostics already exist, the system must be able to
replay them after pairing or a full workspace sync.

Acceptance criteria:
1. If compilation has already run before pairing completes, the app can still
   surface the cached diagnostics after sync.
2. A successful resync does not silently discard previously available
   diagnostics that should remain visible.

### FR-25 Default ambient generation

Requirement: The base compilation flow must work with internally generated
ambient declarations and no externally supplied ambient overlay.

Acceptance criteria:
1. An app can use the normal compilation path without providing an ambient
   overlay input.
2. Internal ambient generation derives from the authoritative semantic runtime
   state rather than requiring app injection.
3. Internal ambient generation consumes environment-owned registry state rather
   than process-global hidden globals or a TypeScript-specific declaration
   generator embedded in core.

### FR-27 Compiler-controlled system files

Requirement: Compiler-controlled system files must remain authoritative even if
serialized copies appear in app-managed workspace state.

Acceptance criteria:
1. If a serialized workspace contains a compiler-controlled configuration file,
   the compiler uses its authoritative internal version rather than the
   app-supplied copy.
2. Apps cannot control the authoritative compiler configuration by mutating the
   user-authored workspace snapshot.

### FR-28 Separation of user workspace from compiler-only inputs

Requirement: The system must keep user-authored workspace content distinct from
compiler-only overlays and compiler-controlled system files.

Acceptance criteria:
1. User-authored workspace export and persistence contain only user content.
2. Compiler-only overlays and compiler-controlled system files do not need to
   be smuggled through the user workspace snapshot to affect compilation.

## Non-Functional Requirements

## Compatibility And Cross-target Constraints

### NFR-1 Core-facing cross-target compatibility

Requirement: Any public seam consumed by the core runtime must remain valid for
all supported core targets, including Roblox-oriented consumers.

Acceptance criteria:
1. Shared runtime-facing behavior remains correct across the supported core
   targets.
2. A change that works only for browser or node behavior does not satisfy this
   requirement.

### NFR-2 No platform-specific assumptions in shared runtime-facing behavior

Requirement: Shared runtime-facing behavior must not assume browser-only or
node-only facilities.

Acceptance criteria:
1. Normal runtime semantics, lifecycle, and compiler-output consumption remain
   valid without depending on browser-only or node-only platform behavior.
2. Platform-specific assumptions in shared runtime-facing behavior are treated
   as defects.

### NFR-3 Preserved Roblox import shape

Requirement: The existing root import shape used by Roblox-oriented consumers
must remain a supported shape.

Acceptance criteria:
1. Roblox-oriented application code can continue to use the root package import
   shape with the `brain` namespace.
2. Namespace traversal through `brain.compiler` and `brain.tiles` remains
   supported.

## Reliability And Behavioral Stability

### NFR-4 Cold-start reliability

Requirement: Seam changes must not regress persisted-brain loading or startup
semantic hydration on cold load.

Acceptance criteria:
1. Cold startup with cached semantic metadata still allows persisted brains to
   load before fresh compile output arrives.
2. Fresh compile output still takes over correctly after startup.

### NFR-5 Explicit lifecycle correctness

Requirement: Brain tracking and invalidation correctness must not depend on
garbage-collection timing.

Acceptance criteria:
1. Explicit disposal is sufficient to stop future invalidation and rebuild
   tracking for a brain.
2. The system does not require garbage-collection timing to determine whether a
   brain remains part of runtime bookkeeping.

### NFR-6 Default path clarity

Requirement: If lower-level or legacy surfaces remain available, they must not
be the default or recommended app-facing integration path.

Acceptance criteria:
1. A new app following current product guidance can complete normal integration
   without relying on legacy singleton APIs or low-level transport objects.
2. Any retained lower-level path is clearly secondary rather than the primary
   recommendation.

### NFR-7 Developer guidance clarity

Requirement: Product documentation and guidance must describe the supported
adoption tiers and identify the intended standard integration path.

Acceptance criteria:
1. Public guidance describes runtime-only, runtime-plus-compiler, and full-stack
   bridge-connected adoption.
2. Public guidance does not present legacy singleton or low-level bridge seams
   as the preferred path for new apps.

## Invariants And Preserved Business Rules

### INV-1 Duplicate tile identifiers

Requirement: The system must not rely on duplicate tile identifiers across tile
sources as a normal override mechanism.

Acceptance criteria:
1. Normal integration assumes unique tile identifiers across the effective tile
   set visible to a brain.
2. Correct behavior does not depend on cross-scope shadowing precedence.

### INV-2 Hydrated metadata is semantic-only

Requirement: Cached startup tile metadata must remain semantic-only and must
never be treated as executable action behavior by itself.

Acceptance criteria:
1. Semantic loading can succeed before fresh compile output exists.
2. Executable authored-action behavior is not considered available until fresh
   compile output provides it.

### INV-3 Fresh compile output is authoritative

Requirement: Once fresh compile output for authored tiles is available, it must
be treated as authoritative over prior startup fallback metadata.

Acceptance criteria:
1. Stale fallback metadata does not remain active after successful fresh compile
   output for the same authored tiles arrives.
2. The active semantic and executable authored-tile state reflects the latest
   successful compile output.
3. The startup fallback snapshot is not kept alive as a secondary semantic
   layer after the first successful bundle handoff.
4. Bundle-managed authored tile state is defined by the latest complete bundle
   snapshot, not by accumulation of incremental tile diffs.

### INV-4 User workspace versus compiler-owned inputs

Requirement: User-authored workspace content, compiler-only overlays, and
compiler-controlled system files must remain distinct categories.

Acceptance criteria:
1. User workspace persistence does not need to include compiler-generated or
   compiler-controlled files in order for compilation to work.
2. Compiler-only inputs do not become part of the user-authored content model
   merely because they may appear in serialized form.

### INV-5 Bridge connectivity and compilation remain independently optional

Requirement: Bridge connectivity and compilation must remain independently
optional layers.

Acceptance criteria:
1. An app can use bridge connectivity without enabling compilation features.
2. An app can use compilation without enabling bridge connectivity.

### INV-6 Advanced access is secondary

Requirement: Advanced or lower-level APIs may exist, but they must remain
secondary to the standard app-facing integration story.

Acceptance criteria:
1. The normal path for new apps does not require advanced or low-level APIs.
2. Advanced APIs are not presented as the primary integration boundary.

## Edge Cases And Failure Modes To Test

- Two runtime contexts exist in the same process and must not leak semantic or
  executable state into each other.
- A persisted brain loads before fresh compile output arrives and must still
  deserialize when cached semantic metadata exists.
- Fresh compile output arrives after startup hydration and must replace the
  fallback semantic metadata rather than coexisting with it indefinitely.
- A hydrated tile exists in cached startup metadata but not in the first fresh
   bundle, and it must disappear after the atomic handoff instead of lingering
   as stale fallback state.
- A hydrated tile and a fresh bundle tile share the same tile ID, and the
   bundle tile must win because the hydrated fallback snapshot is removed
   atomically rather than left in lookup order ahead of it.
- Two authored actions share a parameter tile, one action changes, and the next
   emitted bundle must still include the shared parameter tile so it does not
   disappear during atomic bundle replacement.
- Authored actions are removed and only dependent brains should invalidate.
- Rebuild work is deferred to a later frame or batch boundary and must still
  rebuild the correct invalidated brains.
- A brain is disposed after being created and must not remain in future
  invalidation or rebuild tracking.
- A created brain is used through the supported seam for ticking and runtime
   inspection, and the app must not need to downcast to a concrete runtime
   class to access program, page, scheduler, or execution-context state.
- Many live brains are created from one shared authored definition, and each
   must keep independent runtime state even though the source definition is the
   same.
- A bridge-connected extension pairs after compilation has already run and must
  still receive the correct diagnostics through replay.
- No external ambient overlay is supplied and the default compilation path must
  still work.
- A serialized workspace contains compiler-controlled system files and the
  authoritative compiler-owned version must still win.
- Full import or full sync updates many files and persistence must still occur
  as one coherent snapshot write.
- Presentation configuration changes in one context and must not affect another
  context's semantics or presentation.
- Duplicate tile identifiers appear across tile sources and the system must not
  depend on shadowing behavior as the normal way to resolve them.
- The documented new seam and the real app path diverge; this is a product
  failure even if lower-level internals still technically work.