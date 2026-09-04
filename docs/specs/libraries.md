---
title: Libraries (projects as dependencies)
status: Shipped
---

# Libraries

Libraries let a Wendoo project depend on other Wendoo projects. A
library is not a distinct artifact kind: it is an ordinary project, added to
another project as a dependency. Library support lives in the core project
model; host applications surface it.

## Concepts

- **Project.** The only unit of authorship and packaging. A project carries a
  content manifest holding its display name, semantic version, and its own
  `extensions` list. The project interchange document (`.wendoo`) embeds
  that manifest verbatim alongside the contents of the project's files --
  the manifest is the one schema, and the document adds only what a
  single-file container requires: a format marker and the file contents.
  Everything that is not a file travels inside the manifest (brains and
  application-specific content as application chunks), identically in an
  interchange document, a published repository, and a shared upload.
- **Library.** Any project added as a dependency of another project. The
  manifest's dependency list is the `extensions` field.
- **Host project.** The project whose `extensions` list names the dependency.
- **Host application.** The app that loads a project, compiles it, and decides
  which parts of each library's content to surface.

## Identity and namespacing

**A library's identity is its `<owner>/<repo>` coordinate**: a name in a
namespace Wendoo defines, independent of how the content is delivered. The
transports below (remote, app-embedded) are delivery mechanisms, not
identity schemes -- GitHub is where remote content is fetched from, not what an
identity is; no identity carries a transport prefix. For remotely fetched
content the coordinate mirrors the repository it was fetched from, so its owner
segment is a real, owned GitHub handle and an identity cannot be claimed by
content that does not live there; embedded content carries a declared
coordinate under an owner the platform controls. A fork is a
different coordinate and therefore a different library. Two dependents unify
on a shared dependency exactly when they reference the same coordinate.

Every symbol a library contributes -- types, tiles, Systems, conversions,
and symbols derived from them (accessor tiles, variable factories, output
keys) -- is keyed under its coordinate by its exported binding name:
`<owner>/<repo>::<binding>`. The host project's own symbols are keyed the same
way under the host project's stable store identifier (a GUID). A coordinate
always contains exactly one `/` and a store identifier never takes that shape,
so the two namespaces cannot collide; there is no unprefixed namespace.

A project's public symbol surface is defined by its **entry module**
(`index.ts`): name-keyed declarations (struct types, Systems, classes,
interfaces, aliases) are published exactly when the entry module exports
them, under their entry-exported name -- `<owner>/<repo>::<name>`. Publication
follows the entry, so moving declarations between files never changes a
published symbol's identity, and an author may reorganize source freely
without breaking consumers; renaming a published name is a breaking change,
as renaming a public export is in any ecosystem. A declaration may be
published under exactly one name (publishing one declaration under two
aliases is a compile error). The published surface's type closure must
itself be published: a published type or tile whose fields, parameters, or
results reference an unpublished name-keyed type is a compile error, the
same rule TypeScript's declaration emit applies to exported names using
private ones. A project with no entry module publishes no named symbols.

Everything not published is module-private with ordinary TypeScript
semantics: two files may declare or export the same name without collision,
and private declarations register under a private file-qualified key,
invisible to consuming projects. Tiles (sensors, actuators) do not ride the
entry mechanism: their identity is their persisted id, and a library's
tiles surface to consumers by existence. Publication gates cross-project
visibility only -- within its own project, every tile and type is fully
available regardless of exports or entry.

A dependency is imported and stored by its **`<owner>/<repo>` coordinate**,
which is its identity, not by a renamable local alias. Host-project and library code
import from a dependency through the specifier `@lib/<owner>/<repo>` (exactly
the two coordinate segments; a longer path is a deep import and is rejected),
and its installed content lives at `.libraries/<owner>/<repo>/`. The import
specifier is derived from identity: the same library imports identically in
every project, and two libraries differ in import exactly when they differ in
identity. Identity, saved-brain references, type unification, the import
specifier, and the install path all follow the coordinate -- there is no
separate local name to choose or collide. Renaming or moving a source repository is an
identity migration: fetches under the old name keep working where the hosting
service redirects them, but adopting the new identity is an explicit,
consumer-visible step (see catalog moves below for the managed form).

## Adding libraries: by reference

A library is added by reference: the host project's `extensions` list records
where the dependency comes from, and installation fetches the library's
source into the host project.

Reference transports:

- **Remote.** A URL to an immutable snapshot of a project repository at a
  tagged commit, served by a CDN (for example a jsDelivr URL naming a GitHub
  repository at a tag). The tag is an exact pin and a pure routing specifier:
  it names what to fetch and carries no other meaning.
- **App-embedded.** Content bundled with the host application, serving the
  application's shipped libraries offline. Each embedded library declares
  its **canonical `<owner>/<repo>` coordinate** in the application's embed
  record -- under an owner the platform controls -- so the embedded copy and
  any later published copy are the same library. Embedding is delivery only;
  the identity is the coordinate, and the content installs into `.libraries/`
  exactly like any other dependency -- the bundle is simply the fetch source in
  place of a network download.
Fetched transports install identically and differ only in provenance. A
host application may satisfy a fetch from a
machine-local, pre-seeded library cache before reaching the network. What
the cache holds is a deployment concern -- an application may seed it with
approved catalog libraries, or an administrator may provision a curated
set for offline environments. A cache-satisfied install is an ordinary
install: identity, layout, and compilation are unchanged, and the cache is
a fetch source like the app bundle, not a transport of its own.

Development linking is a resolution-time affordance of a development
surface, not a reference form. A workspace or application may link a
coordinate to a local source -- a workspace folder, a store project -- and
while linked, that coordinate resolves to the local source wherever it
appears in the transitive closure, with edits streaming through the same
recompile pipeline as the host project's own. The manifest keeps its real
references and never records links; unlinking restores ordinary
resolution. A link may satisfy a declared reference that is not yet
fetchable, serving co-development of a dependency that has not yet
published its first version. A catalog move applies before a link: the
link is matched against the coordinate the move resolves to, so a link
never pins a coordinate the catalog has migrated away from. A coordinate
that cannot be linked unambiguously is not linked -- it resolves
ordinarily and the condition is surfaced, never settled by choosing among
the candidates.

A host application's add-by-reference affordance accepts generous input: a
repository URL in any common form, a bare `<owner>/<repo>` coordinate, or a
reference, normalized to a reference before installing. Input that names a
repository without a version resolves to the repository's latest published
version; input that names a tag, commit, or branch resolves to the
corresponding reference form. Only reference forms are ever recorded in the
manifest.

A host application may designate **default libraries**: libraries included
in every project's `extensions` list at creation. A default library is an
ordinary dependency thereafter. Embedded library content may be sourced
from the application's own bundle or from a platform package the application
ships with; either way the embed record is the authority for the library's
canonical origin and version. A
library's version is read from its installed content's manifest, uniformly
across transports. An installed library whose manifest lacks a valid
semantic version is warned about at install time and compared as the lowest
version.

Installed library content **persists in the project store**. A project
never depends on its sources being reachable after installation: an
unreachable source affects only new installs and reinstalls, never an
existing project.

## Mounts and the platform substrate

A **mount** is read-only content -- source files, type declarations, or both
-- presented to a project's file system and compiler by a declared provider.
Mounts are the one mechanism by which content reaches a project from outside
its own files. They have two kinds of provider:

- **Libraries produce mounts through their lifecycle.** A fetched
  library's installed snapshot is a mount; a development-linked
  coordinate is a live mount of its linked source.
- **Platform layers produce ambient mounts directly.** The core package
  contributes its ambient type declarations, the target package contributes
  the device API declarations, and a host application may contribute its
  own. Ambient mounts have no manifest entry and no lifecycle: they are
  always present, version with the application, and are invisible to
  dependency resolution. The platform's version is expressed through the
  project `targets` section, which is also where libraries declare their
  compatibility with it.

The boundary between the two: content whose implementation is sandboxed
user-code belongs to the library domain; surfaces implemented by the host
itself (host functions, built-in tiles, native types) are platform
substrate. A platform layer that ships compilable user-code delivers it as a
default embedded library; its type declarations ride an ambient mount;
its host registrations are not content and have no mount at all.

Symbol namespaces follow the same three-way split: platform symbols keep
their well-known unprefixed identifiers (the shared vocabulary all projects
and libraries unify on -- a host has exactly one platform); the host
project's own symbols are keyed under its store identifier; library
symbols are keyed under their origin.

## Install layout

Every dependency, regardless of transport, installs its source under a
libraries folder in the host project (`.libraries/<owner>/<repo>/`), each as
a complete project. The transports differ only in how the content is fetched
(bundle read, CDN download); installation, layout, and
compilation are identical. The installed tree is read-only and reproducible: it
can be regenerated from the manifest and the project store, so it need not bloat
the saved project. Installed library content is built by the host project's
local compilation pipeline; there are no prebuilt artifacts.

The installed source is a first-class, inspectable surface: a user reading or
writing code can browse every dependency's source under `.libraries/` to learn
its API, and a debugger can map execution to those real source paths and step
into dependency code. Dependencies are therefore materialized as real files,
not served through a compiler-only view.

## Dependency resolution

Libraries may declare their own libraries; resolution is transitive, and
dependency cycles are rejected. All references are exact pins. A host project
holds at most one instance of any origin. When resolution encounters the same
origin at two different versions, the higher semantic version (from the
installed manifests) is selected and a warning names both requesters; when
the versions are equal but the references differ, the reference nearest the
host project wins and a warning is emitted.

## Installing: transactional, with an outcome report

Installation never edits host-authored files, so it is cleanly transactional
and cleanly reversible. Adding a library resolves, installs, recompiles
the project (libraries and host code) and re-typechecks its brains, then
compares diagnostics against the pre-install baseline:

- **Improved** -- pre-existing problems resolved -- the install commits and
  the improvement is reported.
- **Unchanged** -- the install commits silently.
- **Worsened** -- the install still commits, and a non-blocking notice names
  the new problems and offers a one-step undo. Keeping the install supports
  multi-step upgrades whose intermediate states are worse than their end
  state; undoing reverts the manifest entries and re-resolves.

A project with pre-existing errors can always add libraries: the gate is the
difference against its own baseline, never a cleanliness requirement. When
the new problems appear only in content that was already failing, the notice
directs attention there rather than blaming the library. Installation
refuses outright only on mechanics failures -- an unreachable source, an
unparseable manifest, a dependency cycle -- where no coherent state exists to
commit.

Adding a library whose dependencies require others installs the whole set
as one transaction with one outcome. Updating several libraries together is
likewise a single transaction judged by its end state.

Every fetched dependency in a project's `extensions` list carries an update
affordance: on demand, the host checks the dependency's transport for a
newer version (a newer tag for remote origins, the catalog for approved
entries) and applies it as an ordinary transactional install with the same
outcome report. For a coordinate the catalog lists, the offer resolves to
the entry's approved pin, so applying an update keeps the project on
approved content. Update checks happen on request, not in the background.
A development-linked coordinate has no update affordance while linked --
it is always current.

Installation events -- take-newer resolutions, tie-break warnings, installs,
removals, undos -- are recorded in the project's install log. The log is a
record, not a channel: nothing in it requires action, and where an
application surfaces it is the application's choice.

## Compilation and registration

Installed libraries compile in dependency order, each as its own compilation
root, before the host project's own sources. Registration into the shared
registries uses register-if-absent with origin-namespaced keys, so a project
depended on by several libraries registers once and all dependents see the
same types, tiles, and derived symbols. Removing a library unregisters its
contributions symmetrically; saved brains that reference a removed
library's tiles degrade to missing placeholders and the project still loads
and compiles. Compile outcomes are independent of compile history: switching
projects, or changing a library's resolved version, never lets a previous
resolution's registrations satisfy the next.

Host-project code and library code import from a library by its
`<owner>/<repo>` coordinate through a dedicated specifier prefix
(`@lib/<owner>/<repo>`, exactly the two coordinate segments), resolved via
the importing manifest's `extensions` list to the installed library's entry
module. Consumers import the published surface only; a longer path is a deep
module import and is rejected. A project's own modules keep ordinary relative
imports.

## Content kinds, targets, and host-app surfacing

A project's content declares its kind. Core defines the manifest schema,
resolution, installation, compilation, and namespacing for all kinds; each
host application chooses which kinds it surfaces and where. Code content --
the TypeScript payload that produces tiles, types, Systems, and conversions
-- is the foundational kind, and library tile catalogs appear in the host
application's tile picker. Content kinds a host application does not
recognize are ignored gracefully.

A library is a real project, so beyond its code surface it may bundle
arbitrary payload: demo brains and per-target assets such as sound effects,
bitmaps, tilemaps, animations, 3d objects, and whole scenes. This payload is
opaque to the library system. The system compiles and indexes the code
surface and resolves declared capabilities; bundled payload passes through
un-interpreted -- it is never validated for shape and is never a reason to
reject or block a library. The materialized install tree and the host
application's file serving deliver these bytes verbatim for the host
application or target runtime to consume.

A project declares its content in its manifest's `files` list: every source
and asset file the project comprises, at project-relative paths. The list is
authoritative for assembling the project's content. A host application loading
a project as an embedded or dependency library, and a build packaging a
project for delivery, assemble that content by reading the manifest and loading
exactly the files it names -- never by enumerating another project's files
themselves. A file is thus added to a project by editing only that project's
own manifest, and the addition is seen wherever the project is embedded or
depended on, with no change to the consumer. Code files are compiled and their
published symbols registered; asset and other payload files, which no import
graph reaches, are declared here and carried through opaquely. The manifest is
always part of the project and does not list itself. A project need not comprise
content files when it is a runnable target: such a project provides a
host-application bundle rather than a library surface, so its `files` list is
empty (equivalently, omitted) and it reaches consumers only through its manifest
-- its dependency edges and the platform it delivers. Every other project
declares the content files it comprises.

Membership is asymmetric. The project's storage is a filesystem and may hold
more than the build: a file present in storage but absent from the list is
simply not part of the build -- a source kept but excluded, an asset not
shipped, a scratch file -- which is valid and never an error. A listed file
absent from storage is the error direction: the build names content it cannot
assemble. A build validates only that direction; it does not object to
unlisted files.

Compatibility between a library and a host project is determined by the
project `targets` section: a library is compatible when it declares a
target the host project's platform satisfies, and the library browser
filters what it offers accordingly. Every library declares at least one
target; a library usable on several platforms enumerates each of them --
there is no universal wildcard.

## Creating projects from a target

A new project for a platform is created from that platform's target. This
mechanism is a planned authoring surface; its intended shape is recorded here,
and the parts noted as open are not yet settled.

Creation has two layers. A harness-derived skeleton is produced from the
target's own manifest with no target code: a manifest naming the new project,
starting at an initial version, declaring the chosen target in its `targets`
section, and seeding the libraries the target names -- together with the
generated files a project of that platform needs, namely an editor and compiler
configuration mapping the `@lib` import prefix to the install tree, an ignore
list for generated files, and a host-application recommendation. A target that
needs nothing more is complete from the skeleton alone and ships no creation
code.

Beyond the skeleton, a target may provide a create entry: a self-contained
module the harness invokes to generate project content, for a target whose
starting project is dynamic -- a procedurally seeded starter or a generated
example -- rather than a fixed set of files. The create entry is a pure
function: it performs no filesystem, network, or platform access, and it
returns a description of the project -- manifest fragments merged onto the
skeleton and a map of project-relative files -- which the harness writes. Every
capability it uses is provided to it: the chosen name and options, a way to ask
the user for input that each harness renders in its own interface, and a source
of randomness the harness seeds. Because the entry holds no ambient authority
and returns data rather than writing it, one implementation serves every
harness -- the command-line tool, the editor library, and the browser
application -- identically, and it is safe to run inside a host application's
sandbox. A target whose starting project is fixed may instead ship a static
template of files the skeleton composes with; template and create entry compose
when both are present.

Creating a project fetches the target on the same pinned, catalog-governed,
cacheable rails as a dependency, so creation works offline once cached. A fresh
project records no identity; identity is acquired at its first publish. A
create entry is code the target ships: an end-user host application keeps it
within the sandbox, while the developer command-line tool, following the
package-ecosystem norm, may execute a pinned, catalog-approved entry after a
first-use consent that names the target and its exact commit.

Open, not yet settled: whether a create entry drives interactive prompting or
receives pre-collected answers; whether creation also materializes the
platform's library stack into the project or defers that to first open; the
isolation the developer tool enforces around a create entry beyond pinning and
consent; and how the create-entry contract is versioned as it evolves.

## Catalog and approved libraries

A host application may consume a catalog: a curated document listing
approved libraries with their origins, versions, targets, and moves.
The catalog's delivery is at the application's discretion -- bundled with
the application, hosted in the application's own repository and fetched at
runtime, or served -- and its integrity rests on the application's trust
root; for a repository-hosted catalog, that root is the repository's
maintainership. Curation may be an ordinary repository workflow: third
parties propose a new library, or an update to an approved one, as a pull
request against the catalog document, validated mechanically and merged by
the maintainers. The catalog is a trust authority:

- Approval pins exact content: a catalog entry references each approved
  version by commit (or content hash), so what consumers install cannot
  drift from what was reviewed -- integrity beyond the tag pin, immune to
  moved tags and later pushes. Approval accumulates: the entry offers its
  newest approved version, and the versions approved before it remain
  approved and resolvable. Updating an approved library adds a pin rather
  than replacing one, and reviewing an update is reviewing the difference
  between the pinned states.
- **Moves** carry source reorganization -- a transport change, a coordinate
  rename, an owner move, or a version steer -- as an identity-level claim only
  the catalog makes. A project referencing a captured coordinate migrates to
  the move's destination; the mechanism is detailed under Moves below.
- The catalog owns name governance for what it lists.

The community feed -- user-published projects browsed and downloaded from
within an application -- shares the catalog document shape, differing by
curation status.

## Moves

Sources reorganize: an embedded platform library graduates to a fetched
repository, an author renames or moves a repository, ownership transfers, or
a defective release window must be steered to a corrected version. A **move**
is the catalog's managed, consumer-safe expression of such a change. Moves live only in the catalog -- the trust authority -- and are never
read from fetched package content: a package's claim about its own identity is
unverifiable, so only the curated catalog may assert that one coordinate's
content now lives at another.

A move maps a **source coordinate** to one or more entries, each pairing an
optional **source selector** with a **destination reference**. The destination
alone describes the new home: a destination whose coordinate equals the source
is a transport or delivery change -- identity is preserved; a destination
whose coordinate differs is a rename or owner move, and identity changes with
it. A destination may name exact content (a pin or a branch), or may carry no
version component at all, meaning the latest stable release **at migration
time**: the migration resolves it to a pin and the project records the pin. A
componentless destination is not a tracker -- a project's reference, once
migrated, is always exact, and a completed migration performs no further
resolution.

The selector decides which references an entry captures; the source coordinate
is matched across transports, since a coordinate is one identity however it is
delivered:

- Absent, the entry captures any reference to the source coordinate not
  already delivered from the destination's coordinate and transport. A
  reference already on that home keeps its own version: migration never
  rewrites the version of content that already lives where the move points.
- An exact-reference selector captures only that reference, compared
  structurally.
- A structured selector captures by transport, by a declared-version range, or
  both. A range reads the referenced content's declared version; a reference
  whose version cannot be determined is skipped loudly and retried later,
  never guessed, and a branch reference -- which names no version -- is never
  range-captured.

A reference already equal to an entry's destination is never captured, so
migration is idempotent. At most one entry may capture a given reference:
collisions the catalog can prove are rejected at validation, and a collision
only application can see fails there -- ambiguity is never resolved by entry
order. A componentless destination additionally may not pair with a selector
able to capture references already on the destination's home, which would
re-resolve on every application.

Moves compose. A coordinate may change delivery and later be renamed; a
reference to the oldest home follows the whole chain to the final destination
in a single migration. Chains are validated acyclic by following every entry's
destination through the full move set, and application independently refuses
to revisit a shape, so migration always terminates.

A move is applied by **migration, not by a standing alias**. When a project
resolves a reference a move captures, the pipeline rewrites the project to
adopt the new home: its `extensions`-list reference becomes the final
destination and re-resolves as an ordinary transactional install, reported
like any other update. Serving the old identity indefinitely from new content
is deliberately not the model -- it would keep stale identities resolvable
forever and smear a retired name across every surface that keys on identity.
A migrated project holds only the new identity.

A rename also rewrites identity where the project records it. Saved brains
reference their dependencies' tiles and types by namespace, so a rename that
left those references untouched would strand them; the migration rewrites the
saved-brain reference namespaces in the same step as the manifest, so a
project's manifest and its brains adopt the new identity together and a
project is never half-migrated. Under a chain, every source coordinate the
project holds -- original or intermediate -- rewrites to the final identity.
A move that preserves the coordinate touches no saved reference.

Each captured reference migrates as one unit: its manifest rewrite, its
saved-brain identity rewrite, and the fetches its new home requires succeed or
fail together. Independent migrations are independent -- a migration that
cannot complete (its destination unresolvable, its content unreachable) is
reported and retried on a later resolution without holding up the others.

A move is followed **at every depth of the dependency closure**, for any
reference to the moved coordinate -- whether a top-level entry in the project's
own `extensions` list or a transitive dependency declared inside another
library's content, regardless of which dependent declared it. Following a
move for a transitive dependency resolves the moved content without recording
the coordinate in the host manifest (a transitive dependency is not a manifest
entry) and without altering the declaring library's immutable content. A
dependency can therefore migrate independently of its dependents: a library
moves and every dependent follows, with no dependent republish.

That independence is complete for a transport change and bounded for a rename.
A rename changes identity, and identity is compiled into a published
dependent's import specifiers (`@lib/<owner>/<repo>`) as well as its
saved-brain references; migration rewrites the identities a project owns -- its
manifest and its own brains -- but cannot rewrite a published library's
compiled-in imports. A coordinate imported as a dependency inside a published
library is adopted only by republishing that library; only the
reorganizations a consumer records for itself migrate on the fly.

Governance is the catalog's: every destination must be a valid reference to
content the catalog governs, an exact selector must name its own source
coordinate and differ from its entry's destination, at most one selectorless
entry may exist per source, exact selectors are pairwise distinct, and chains
are validated acyclic as above. Range grammar is the same dialect the
compatibility declarations use; a range outside that dialect is rejected at
validation, never approximated.

## Publishing

Publishing is defined by repository state: a published version is the
project's content at the tag `v<version>` on the author's own repository,
with the manifest version authoritative and matching the tag. A published
repository carries the whole project: the manifest's `files` entries
expanded as individual files on disk, and the manifest itself, which
carries everything else the project comprises -- brains and
application-specific content travel inside `wendoo.json`, preserved
verbatim whether or not the reading application recognizes them. The
published tree also carries a `README.md` for the repository's human
readers: the author's own when the project provides one, otherwise a
generated introduction naming the library or target, its coordinate, and
how to add it. This file is repository furniture and is not part of the
manifest's `files`, so it is never fetched when the project is installed
as a dependency.
Serialized brains reference their own project's tiles and types
namespace-relatively -- the namespace is a field on the persisted
reference, absent for the project's own content and present for another
library's -- so bundled brains survive every change of the project's
namespace (graduation, forks) while references into dependencies stay
exact.

An application's own project document -- its export and import form -- is
deliberately narrower than the published repository form. It models the
authoring fields: name, version, description, libraries, targets, brains,
and per-application content. An import adopts only those; a manifest field
outside that set does not survive an application's import. Repository-form
fields -- identity, files, ambient declarations, a host-application
bundle -- belong to the published checkout, and a project bound for
publication acquires them through rehydration, which reconstructs the
project directory from the document.

Publishing is performed with the Wendoo command-line tool -- against a
repository checkout or a project directory -- or by any ordinary git
workflow that satisfies the contract. The web editor does not publish: it
is a credential-free surface. A project authored in a host application
graduates instead: export the project document, rehydrate it as a project
directory with the command-line tool, and publish from there. (Web-native
sharing, with no git or repository required of the user, is the community
feed.) Creating the repository is the author's act that claims the
library's identity; the first publish to an empty repository may carry
the manifest's current version as published, and every subsequent publish
bumps the version. Every publish stamps the repository's coordinate into
the manifest as the library's identity; the coordinate is always
recorded by tooling, never hand-authored. Republishing cloned content to a
different repository is a fork: the publish restamps the new repository's
coordinate, creating a new library that shares history -- the original
library and its consumers are unaffected. When a publish changes the
manifest's previously recorded identity, it says so. The publish command owns the whole sequence: it bumps
the manifest version (patch, minor, or major), verifies the working tree is
otherwise clean, commits, creates the tag `v<version>` matching the new
manifest version, and pushes the branch and the tag.
The command discovers what it can rather than requiring it: run from a project
directory, it takes that directory as the project, and it determines the
publish location from the project itself -- the checkout's own remote when the
checkout is the library's repository, otherwise the location derived from the
recorded identity coordinate. An explicit location may be given to override the
derivation, and is required for the first publish, before an identity is
recorded.
When the project's `extensions` list contains a dependency that is not
stable for consumers -- a reference to a version that has never been
published, or a branch reference, whose target moves -- the publish command
asks for confirmation first: such a project may not work, or may not keep
working, for anyone else. It proceeds only on explicit consent. Published library
repositories are public (the CDN transport serves public repositories).

Separately, a host application can offer publishing a project to the
Wendoo community feed: users submit project snapshots from within the
application and browse and download other users' projects, with no repository
hosting required of the user.

## Security properties

- No code executes at install time. Installation fetches, resolves, and
  registers; nothing in a library runs until a brain runs.
- Library code executes as Wendoo VM bytecode inside the sandbox, under
  the same budgets and host-call surface as the host project's own code. A
  library has no JavaScript execution in the host page.
- Catalog content-hash pinning, where present, binds an approved version to
  exact bytes independent of the hosting service.
