# Docs Sidebar — Implementation Spec

## What this document is

This is both a design spec and an implementation prompt. It describes a help/documentation sidebar for the Mindcraft brain editor UI. The sidebar lives in the `ui` package of this monorepo.

Read this document fully before writing any code. Ask clarifying questions if anything is ambiguous. Do not begin implementation until you understand the full scope of the current phase.

---

## Overview

We need a documentation sidebar that lets users explore the Mindcraft brain language, read tile reference docs, see rendered brain-code examples, and insert those examples into their editor.

The sidebar is a **sibling** to the brain editor dialog, not a child of it. It shares the viewport, not the editor's DOM tree.

---

## Design Decisions (already made — do not revisit)

1. **Relationship to editor:** Sibling panel. Not embedded in the editor dialog. Contextually linked via deep-link (e.g. right-click a tile -> "Help on this tile" opens the sidebar scrolled to that entry).

2. **Desktop layout:** Right-edge slide-out panel, ~320-380px wide. Overlays the viewport. If the brain editor is open, the help panel sits on top of the editor's right margin. The editor does not resize or reflow.

3. **Mobile layout:** Full-screen view with a back button. Mental model is a navigation stack push. When the user taps "Copy" on an example, it copies to a structured clipboard, closes the help panel, and shows a toast ("Example copied — paste into a rule").

4. **Opening trigger:** A persistent tab/handle anchored to the right edge of the viewport (book icon or similar). Always visible regardless of whether the editor is open. Tap to expand, tap to collapse.

5. **Content structure — three tabs:**
   - **Tiles** — One entry per tile. Icon, name, category, one-sentence description, what it connects to, minimal inline example.
   - **Patterns** — Named brain snippets solving common problems. Rendered brain-code block + one-paragraph explanation + Copy button.
   - **Concepts** — Longer explanations of the mental model (pages, rule priority, frame execution, WHEN/DO flow). Linked from Tiles and Patterns, but not a prerequisite.

6. **Navigation:** Tabs or segmented control at the top of the panel. Not a sidebar-within-a-sidebar.

7. **Search:** Simple text field at the top. Substring match across all three sections. Corpus is small (30-60 tiles, 15-25 patterns, 5-10 concepts), so no indexing needed.

8. **Rendered brain-code examples:** Use the same React tile components from the brain editor, but in read-only mode. No drag handles, no add buttons. Just the visual tiles.

9. **Copy mechanism:** Each rendered example has a "Copy" button. On desktop, copies structured data to clipboard. On mobile, always clipboard + toast.

---

## Content Authoring Format

Documentation pages are authored in **Markdown** with a custom fenced code block for brain code.

### Brain code fence format

````
```brain
[{"when":[...],"do":[...]},{"when":[...],"do":[...]}]
```
````

The content inside a `brain` fence is **JSON-serialized brain code** — the same format used by the existing component serialization/deserialization and the editor's clipboard for copy/paste. This is a deliberate choice:

- All brain components already serialize to and deserialize from JSON.
- The editor's clipboard already uses this JSON format.
- The "Copy" button can pass the fence content directly to the clipboard with zero transformation.
- No new parser or text serialization format needs to be designed or maintained.

The tradeoff is that JSON is not pleasant to hand-author in markdown. In practice, doc authors will **copy rules from the editor** (which produces JSON via the existing clipboard) and **paste them into the markdown fence block**. This is acceptable given the small corpus size and the elimination of an entire translation layer.

The custom fence handler in the markdown pipeline:

1. Parses the JSON into the same data structures the editor uses (via existing deserialization)
2. Renders those structures using the existing read-only tile components from `ui`
3. Attaches a "Copy" button that writes the JSON directly to the editor's clipboard utility

### Markdown processing pipeline

Use `remark` + `rehype` (or whatever markdown pipeline the project already uses — check before adding dependencies). Register a custom handler for `brain`-fenced code blocks that:

1. Parses the text serialization into rule/tile data structures (using a parser from `core`)
2. Renders those structures using the existing read-only tile components from `ui`
3. Attaches a "Copy" button below the rendered block

### Frontmatter

Each markdown doc should support YAML frontmatter for metadata. Keep frontmatter minimal — do not duplicate data that can be derived from existing systems.

**Tile docs:**

```yaml
---
tileId: see
tags: [vision, detection, query]
---
```

`tileId` is the primary key. The sidebar resolves label, icon, and category at render time by looking up the tile definition through the existing tile visual service. **Do not duplicate label, icon, or category in frontmatter** — the tile definition is the source of truth.

**Patterns:**

```yaml
---
id: flee-predator
title: Flee from Predators
tags: [movement, survival, avoidance]
difficulty: beginner
---
```

**Concepts:**

```yaml
---
id: rule-priority
title: How Rule Priority Works
tags: [rules, execution, fundamentals]
---
```

---

## Implementation Phases

Do these in order. Each phase should be a working, testable increment. Do not skip ahead.

### Phase 1 — Panel shell and layout

**Goal:** Empty sidebar that opens/closes correctly on desktop and mobile.

- Create a `DocsSidebar` component in `ui`.
- Implement the right-edge tab/handle (collapsed state).
- Implement the slide-out animation (expanded state, ~350px wide).
- Implement mobile detection and full-screen mode with back button.
- Wire up open/close state. Use a context or lightweight store so other components (like the brain editor) can trigger it.
- Implement the three-tab navigation (Tiles / Patterns / Concepts) with empty content areas.
- Implement the search input field (non-functional in this phase — just the UI).
- Z-index should be above the main viewport but test it with the brain editor open to ensure it overlays correctly without blocking the editor's left/center content.

**Test:** Sidebar opens and closes. Tabs switch. Responsive breakpoint switches to full-screen mode. Brain editor remains usable when sidebar is open (on desktop).

### Phase 2 — Markdown pipeline and brain-code renderer

**Goal:** Markdown content renders correctly, including brain-code blocks as visual tiles.

- Set up the markdown processing pipeline. Check what the project already uses before adding remark/rehype.
- Implement the custom `brain` fence handler. It takes the JSON content of the fence, deserializes it using the existing brain component deserialization (already in `core`), and renders read-only tile components from `ui`.
- No new serialization format or parser is needed. The JSON format is already defined by the existing serialize/deserialize infrastructure.
- Implement the "Copy" button below each rendered brain-code block. It writes the fence's JSON content directly to the editor's clipboard utility — no transformation required.
- Create a few test markdown files (one Tile entry, one Pattern, one Concept) to validate the full pipeline. Generate the JSON for test brain-code fences by copying rules from the editor.
- Render inline tile icons in prose. When markdown contains something like `` `tile:see` `` (where `see` is the `tileId`), render the actual tile icon component inline by looking it up through the tile visual service.

**Test:** A markdown file with prose, a brain-code fence, and an inline tile reference all render correctly in the sidebar. The "Copy" button successfully writes to the editor clipboard and the rules paste correctly.

### Phase 3 — Content registry and loading

**Goal:** Real content populates the sidebar, sourced from multiple packages.

#### Content ownership model

Tile documentation is NOT all owned by one package. The vocabulary is defined at multiple levels:

- **`core`** defines and documents core language constructs: variables, literals, operators, expressions, page control flow (`Switch Page`, `Call Page`, `Restart Page`), and core data types.
- **`ui`** owns the sidebar component and rendering pipeline. It may document UI-specific concepts (e.g. "How to use the brain editor") but does NOT define tile docs.
- **The app** defines and documents all game-specific tiles. In the ecology sim, this means sensors like `[see]`, `[bump]`, actuators like `[eat]`, `[move]`, `[turn]`, entity-type modifiers like `[carnivore]`, `[plant]`, `[herbivore]`, distance modifiers like `[nearby]`, etc. The app also contributes game-specific Patterns and Concepts.

This means the sidebar cannot statically import a fixed set of docs. It must consume a **DocsRegistry** populated at app initialization.

#### DocsRegistry design

- Define a `DocsRegistry` interface in `ui` (or a shared types location). It holds three collections: tiles, patterns, concepts.
- **Tile entries** are keyed by `tileId`. The registry entry contains only the `tileId`, `tags`, and `content` (markdown string or pre-parsed AST). Label, icon, and category are resolved at render time from the tile definition via the existing tile visual service. Do not store derived metadata in the registry.
- **Pattern and Concept entries** use an `id` + `title` since they are not backed by tile definitions.
- `core` exports a function like `getCoreDocsEntries()` that returns its doc entries.
- The app imports that, adds its own entries, and passes the combined registry to the sidebar component (via context, props, or whatever state pattern the project uses).
- The sidebar never knows or cares where an entry came from.

This is the same pattern as tile registration itself — the app is the composition root. The docs registry should mirror that.

#### Where markdown files live

- `core/src/docs/tiles/` — core language tile docs
- `core/src/docs/concepts/` — core language concepts (rule evaluation, data types, etc.)
- `apps/{app}/src/docs/tiles/` — app-specific tile docs
- `apps/{app}/src/docs/patterns/` — app-specific patterns
- `apps/{app}/src/docs/concepts/` — app-specific concepts (if any)

Each package is responsible for bundling its own markdown content (via static imports, raw-loader, or however the build system handles it). The app composes them into one registry at startup.

#### Navigation and search

- Populate the Tiles tab from the registry, rendered as a scrollable list of cards. Consider grouping by category (sensors, actuators, modifiers, operators, control flow) with collapsible sections.
- Populate the Patterns and Concepts tabs similarly.
- Implement search filtering across all tabs. For tiles, resolve label and category from the tile definition at filter time — search should match against the label the user sees, not just the `tileId` and `tags` in frontmatter. For patterns and concepts, filter on `title`, `tags`, and full-text body.
- Implement navigation: tapping a card in the list opens the full doc. Back button returns to the list.
- Category groupings should be part of the registry metadata, not hardcoded in the sidebar. The app might define categories that core does not.

**Test:** The ecology sim app contributes tile docs for `[see]`, `[eat]`, etc. Core contributes docs for `[Switch Page]`, variables, operators. Both appear in the sidebar, properly categorized. Search filters across both sources.

### Phase 4 — Contextual linking and Copy

**Goal:** The sidebar connects to the editor.

- Expose a `openDocsForTile(tileId: string)` function (or event) that opens the sidebar to the Tiles tab, navigated to the matching entry. The `tileId` is already available on every tile in the editor.
- Wire this into the brain editor: add a context menu item or long-press action on tiles that triggers it.
- Implement the "Copy" button on Pattern examples. The brain editor already has a clipboard-like utility for copying and pasting brain rules. The docs system should use this directly — **do not invent a separate clipboard format or insertion mechanism.** The "Copy" button should write to the same clipboard the editor already reads from, so that the user's existing paste workflow just works.
- Investigate the existing clipboard utility before implementing. Understand: what data structure it holds, how it is populated, how paste is triggered, and whether it supports pasting multiple rules at once (since a Pattern example may contain more than one rule).
- On both desktop and mobile, show a toast confirming the copy. On mobile, also close the sidebar to return the user to the editor.

**Test:** Click a tile in the editor -> dropdown menu -> select "Help", opens the sidebar to the correct entry. "Copy" on a pattern writes to the editor's existing clipboard. Pasting in the editor reconstructs the rules using the normal paste flow. Multi-rule patterns paste correctly.

---

## Technical Constraints

- No server-side rendering. This is a static webapp.
- All content must be bundled or statically imported.
- Minimize new dependencies. Check what the project already uses before adding anything.
- The panel must not break the brain editor's existing functionality.
- The panel's state (open/closed, current tab, current doc) should survive the brain editor opening and closing, but does NOT need to persist across page reloads.
- Prefer CSS transitions over JS animation libraries for the slide-out.

## Style Constraints

- Match the existing app's visual language: dark backgrounds, rounded cards, same color palette.
- The sidebar should feel slightly muted compared to the editor — it is reference material, not the creative workspace.
- Use the actual tile icon components inline in documentation. Do not use static images or emoji substitutes for tiles.
- Do not add any animation beyond the panel slide. No bouncing, no fading content, no staggered list reveals.

---

## What NOT to build

- Interactive tutorials or guided walkthroughs.
- Video embeds.
- AI-assisted help or chat.
- Community content or user-submitted examples.
- Editing capabilities for docs within the app.
- Bookmarking or "favorites" within the help panel.
- Analytics or tracking of help usage.

---

## Build Log Instructions

At the end of each phase, append a short entry to the Build Log section at the bottom of this document. Note what was implemented, what deviated from the spec, and why. Do not modify the original spec text above. Keep entries concise — a few bullet points, not a narrative.

---

## Questions to resolve before starting

Before writing code, investigate and report back on:

1. What markdown processing libraries (if any) are already in the dependency tree?
2. What is the existing tile component API? What props does a tile component need to render in read-only mode? Is there already a read-only variant?
3. What state management pattern does the UI package use? (Context? Zustand? Signals? Something else?)
4. What does the JSON serialization format for rules/tiles look like? Provide a concrete example of a serialized rule (e.g. the carnivore's "WHEN bump herbivore DO eat" rule). The brain-code fence blocks in markdown will contain this exact format.
5. What is the existing responsive breakpoint strategy? Is there a shared breakpoint constant or media query pattern?
6. What is the existing brain editor clipboard utility's API? What data structure does it hold, how is it populated (programmatically vs. user action only), and does it support multiple rules? The docs "Copy" button needs to write to this clipboard directly.
7. How are tiles currently registered by the app? Is there an existing registry pattern (tile definitions, categories, metadata) that the DocsRegistry should mirror or extend?
8. How does the app's build system handle static asset imports (e.g. raw text/markdown files)? Vite `?raw` imports? Webpack raw-loader? Something else?

---

## Build Log

### Phase 1 — Panel shell and layout

- Created `DocsSidebarContext.tsx` (React context: `DocsSidebarProvider`, `useDocsSidebar`, `DocTab` type)
- Created `DocsSidebar.tsx` with `PanelContent` (desktop) and `MobilePanel` (full-screen) components; `useIsMobile` hook via `matchMedia("(max-width: 767px)")`
- Created `packages/ui/src/docs/index.ts` barrel; added `export * from "./docs"` to `packages/ui/src/index.ts`
- Wired into `apps/sim/src/App.tsx`: `DocsSidebarProvider` wraps the app, `<DocsSidebar />` rendered as a fixed sibling outside the main flex container

**Deviations from spec:**

- **Trigger moved into brain editor toolbar** (not the persistent right-edge handle described in the spec). The right edge conflicts with the app's existing stats sidebar; a `BookOpen` button was added to the undo/redo group in `BrainEditorDialog.tsx` instead. The spec design decision §4 ("persistent tab/handle") is deferred — the trigger location may be revisited.
- **Z-index raised to `z-60`** (above the brain editor dialog's `z-50`) so the panel overlays the editor correctly. Biome canonical class names used: `z-60` and `w-87.5` (Tailwind v4 equivalents of `z-[60]` and `w-[350px]`).
- **`pointer-events-auto` added to panel elements** to override `pointer-events: none` injected on `document.body` by `react-remove-scroll` (used by Radix Dialog) when the brain editor is open. Without this, the sidebar was visually present but completely non-interactive while the editor was open.
- **`closeDocs()` called when brain editor closes** (via `useEffect` in `BrainEditorDialog`) — minor UX tie-in not described in the spec.

### Phase 2 — Markdown pipeline and brain-code renderer

- Added `react-markdown@^9` to `packages/ui` (installed via `npm install`); no other markdown libs existed in the project.
- Created `packages/ui/src/docs/DocsRule.tsx`: `DocsTileChip` (read-only tile chip), `DocsRuleRow` (WHEN/DO rule row), `DocsRuleBlock` (multi-rule block with line numbers), `InlineTileIcon` (inline `tile:xxx` chip for prose). Does not use `BrainEditorConfig` context — reads `IBrainTileDef.visual` directly, so it works outside `BrainEditorProvider`.
- Created `packages/ui/src/docs/BrainCodeBlock.tsx`: parses brain fence JSON, resolves tile defs from `getBrainServices().tiles`, renders `DocsRuleBlock`, and provides a **Copy** button that calls `setClipboardFromJson()`.
- Created `packages/ui/src/docs/DocMarkdown.tsx`: wraps `react-markdown` with custom `code` renderer — `language-brain` → `BrainCodeBlock`; inline `` `tile:xxx` `` → `InlineTileIcon`; standard prose styled for dark sidebar.
- Extended `packages/ui/src/brain-editor/rule-clipboard.ts`: added `setClipboardFromJson(plainRules)` (converts plain JSON array to `RuleJson` + empty catalog, stores first rule); fixed `deserializeRuleFromClipboard` to include `getBrainServices().tiles` in the catalog chain so globally-registered tiles (sensors, actuators, etc.) resolve correctly on paste.
- Updated `DocsSidebar.tsx`: added inline test markdown for each tab (Tiles → `sensor.see` doc with brain fence; Patterns → flee-from-predators with 2-rule fence; Concepts → rule evaluation explanation); extracted `SearchBar` and `TabBar` sub-components to reduce duplication; wired `DocMarkdown` into both `PanelContent` (desktop) and `MobilePanel`.
- Updated `packages/ui/src/docs/index.ts` barrel to export new public symbols.

**Deviations from spec:**

- **"Copy" copies only the first rule.** The brain fence format supports multiple rules; the clipboard model currently holds one rule at a time. Remaining rules are silently dropped. Multi-rule support deferred to Phase 4 as specified.
- **Test content is inline strings, not `.md` files.** Phase 3 introduces the DocsRegistry and Vite `?raw` imports. Using inline strings in Phase 2 avoids a dependency on the registry before it exists.
- **Search UI is wired to state but does not filter content.** The search input is functional (controlled, clears on tab switch) but filtering is a Phase 3 concern once the content registry exists.

**Post-phase fixes:**

- **Text selection destroyed on re-render:** `MD_COMPONENTS` was defined inline in `DocMarkdown`, creating new object references every render. `react-markdown` uses component reference identity to decide whether to remount subtrees; new references caused full remounts that cleared the browser's text selection. Fixed by moving `MD_COMPONENTS` to module-level constant.
- **Content panel did not scroll:** `flex-1 overflow-y-auto` alone does not scroll -- flex items default to `min-height: auto`, which prevents the item from shrinking below content height and never triggers overflow. Fixed by adding `min-h-0` to both `PanelContent` and `MobilePanel` content divs.
- **Trackpad/wheel scroll blocked by react-remove-scroll:** Radix Dialog mounts `RemoveScroll`, which adds a document-level wheel listener (bubble phase) that calls `preventDefault()` on events targeting elements outside the dialog's DOM subtree. The docs panel is a sibling of the dialog, so its scroll was blocked. Fixed by adding `onWheel={e => e.nativeEvent.stopPropagation()}` to the scrollable content divs -- React fires `onWheel` at the React root (`#root`), which is below `document` in bubble order, so `nativeEvent.stopPropagation()` prevents the event from reaching `react-remove-scroll`'s listener.
- **Non-ASCII characters:** Replaced em dashes, Unicode arrows, and ellipsis throughout all docs source files per `global.instructions.md` ASCII-only rule.

### Phase 3 — Content registry and loading

- Created `packages/ui/src/docs/DocsRegistry.ts`: `DocsRegistry` class with `register(entries)`, `tiles`/`patterns`/`concepts` getters (typed as `ReadonlyMap`), `tileCategories`/`patternCategories` getters, and `tilesByCategory()`/`patternsByCategory()` methods. Interfaces: `DocsTileEntry` (keyed by tileId), `DocsPatternEntry` (keyed by id), `DocsConceptEntry` (keyed by id), `DocsEntries` (combined input type).
- Created `packages/ui/src/docs/parse-frontmatter.ts`: minimal YAML frontmatter parser. Handles `---` delimited blocks and inline bracket arrays (`[a, b, c]`). Returns `{ meta, body }`.
- Created `packages/ui/src/docs/load-docs-entries.ts`: `loadDocsEntries()` converts raw markdown strings with frontmatter into `DocsEntries`. Accepts `RawDocsInput` with `tiles?`, `patterns?`, `concepts?` arrays, each carrying `raw` (markdown string) and `category` (display category).
- Created 19 core tile markdown docs in `packages/core/src/docs/tiles/` covering operators (`op-and`, `op-or`, `op-not`, `op-add`, `op-subtract`, `op-multiply`, `op-divide`, `op-negate`, `op-equal`, `op-not-equal`, `op-less-than`, `op-less-equal`, `op-greater-than`, `op-greater-equal`, `op-assign`), control flow (`cf-switch-page`, `cf-restart-page`), and core sensors (`sensor-random`, `sensor-on-page-entered`).
- Created 3 core concept docs in `packages/core/src/docs/concepts/`: `rule-evaluation`, `pages`, `data-types`.
- Created 13 app-specific tile docs in `apps/sim/src/docs/tiles/` for sensors (`see`, `bump`, `timeout`), actuators (`move`, `eat`, `turn`, `say`, `shoot`), and modifiers (`modifier-carnivore`, `modifier-herbivore`, `modifier-plant`, `modifier-nearby`, `modifier-faraway`).
- Created 3 app-specific pattern docs in `apps/sim/src/docs/patterns/`: `flee-predator`, `hunt-and-eat`, `wander-default`.
- Created `apps/sim/src/docs/docs-registry.ts`: `createDocsRegistry()` function that imports all markdown files via Vite `?raw` imports, calls `loadDocsEntries()` with category assignments, and registers both core and app entries into a single `DocsRegistry`.
- Updated `DocsSidebarContext.tsx` to accept an optional `registry?: DocsRegistry` prop, defaulting to an empty registry.
- Updated `apps/sim/src/App.tsx` to create the registry via `useMemo(() => createDocsRegistry(), [])` and pass it to `<DocsSidebarProvider registry={docsRegistry}>`.
- Rewrote `DocsSidebar.tsx`: replaced Phase 2 inline test content with registry-driven list/detail navigation. New components: `CategorySection` (collapsible groups), `TileCard`/`PatternCard`/`ConceptCard` (list items with icon, label, chevron), `DocsPanelContent` (shared between desktop/mobile with search filtering, tab bar, category-grouped lists, and detail view via `DocMarkdown`). `NavState` type tracks `{ view: "list" } | { view: "detail"; tab; key }`. Tile labels and icons resolved from `getBrainServices().tiles` via `getTileLabel()`/`getTileIconUrl()` helpers.
- Updated `packages/ui/src/docs/index.ts` barrel to export `DocsRegistry`, entry types, `loadDocsEntries`, and `parseFrontmatter`.

**Deviations from spec:**

- **Core docs are sourced from `packages/core/src/docs/` but imported by the app, not core's build.** Core is a multi-target package (Roblox/Node/ESM) and cannot use Vite `?raw` imports. The app imports core markdown files directly via relative paths (`../../../packages/core/src/docs/...`) through Vite. This keeps core's build unchanged while still allowing core to own its documentation source files.
- **Tile IDs use full `tile.{area}->{id}` format** (e.g., `tile.sensor->sensor.see`, `tile.op->and`, `tile.actuator->switch-page`). Phase 2 test content used bare IDs (e.g., `sensor.see`) which silently failed to resolve in brain fences; Phase 3 corrects this.
- **`cf-switch-page` and `cf-restart-page` use `tile.actuator->` prefix** (not `tile.cf->`). These tiles are registered as actuators in the brain services, despite being conceptually "control flow." Documentation categories them under "Control Flow" for user clarity, but the `tileId` in frontmatter matches the actual registered ID.
- **Search filters across label, tileId, tags, category, and content.** The spec describes search as a Phase 3 concern without specifying which fields; the implementation searches all meaningful text fields.

**Post-phase fixes:**

- **Relative import paths off by one level:** Core doc imports in `apps/sim/src/docs/docs-registry.ts` used `../../../packages/core/...` (3 levels up from `apps/sim/src/docs/`) but need `../../../../packages/core/...` (4 levels). Vite reported "Does the file exist?" at dev time. Fixed all 22 core imports.
- **Brain code tiles wrapped to multiple rows:** `DocsRuleRow` WHEN and DO tile containers used `flex-wrap`, causing tiles to stack vertically in narrow panels. Removed `flex-wrap` from both containers so tiles stay in a single horizontal line. Added `overflow-x-auto` to the outer rule row div so content scrolls horizontally when it overflows.
- **WHEN/DO labels changed to vertical orientation:** Rotated the WHEN and DO badge text 90 degrees with per-letter counter-rotation to save horizontal space in the narrow panel.
- **Navigation state lifted to context:** `NavState` (list vs. detail view) was local to `DocsPanelContent`, making it inaccessible to `DocMarkdown` and other nested components. Lifted `navKey`, `navTab`, `navigateToEntry(tab, key)`, and `navigateBack()` into `DocsSidebarContext`. Tab switching via `setTab()` now automatically resets nav to list view. `DocsPanelContent` consumes context nav instead of local state.
- **Inline tile chips linked to doc pages:** Created `InlineTileLink` component in `DocMarkdown.tsx` that wraps `InlineTileIcon` with a clickable button. Checks `registry.tiles.has(tileId)` -- if a doc page exists, clicking navigates to that tile's detail view via `navigateToEntry("tiles", tileId)`; otherwise renders as a non-interactive chip. Replaced `InlineTileIcon` usage in the `code` handler with `InlineTileLink`.

### Docs architecture restructuring -- Option B (manifest + locale content)

Replaced the Phase 3 approach (relative-path `?raw` imports from core source) with a
build-time codegen architecture that supports npm distribution and future localization.

**Core package (`packages/core`):**

- Created `src/docs/manifest.ts`: locale-independent metadata arrays `coreTileDocs` (19 entries) and `coreConceptDocs` (3 entries). Each entry has `tileId`/`id`, `tags`, `category`, and `contentKey` (filename stem matching content files).
- Created `src/docs/index.ts`: barrel that exports manifest types (`CoreTileDocMeta`, `CoreConceptDocMeta`) and arrays.
- Moved markdown content from `src/docs/tiles/*.md` and `src/docs/concepts/*.md` to `src/docs/content/en/tiles/*.md` and `src/docs/content/en/concepts/*.md`. Stripped YAML frontmatter -- content files are body-only markdown.
- Created `scripts/build-docs.js`: reads all `.md` files under `src/docs/content/{locale}/`, generates `src/docs/_generated/{locale}.ts` exporting `tileContent` and `conceptContent` as `Record<string, string>` with content embedded as template literals.
- Added `build:docs` script to `package.json`, runs before the three `tsc` builds (`build:docs -> build:rbx -> build:node -> build:esm`).
- Added subpath exports: `./docs` -> manifest (esm/node), `./docs/en` -> generated English content.
- Added `src/docs/_generated` to `.gitignore`.
- Excluded `src/docs/**` from `tsconfig.rbx.json` (docs not relevant for Roblox build target).

**App (`apps/sim`):**

- Created `src/docs/manifest.ts`: app-specific metadata arrays `appTileDocs` (13 entries) and `appPatternDocs` (3 entries) with `tileId`/`id`, `tags`, `category`, and `contentKey`.
- Moved markdown from `src/docs/tiles/*.md` and `src/docs/patterns/*.md` to `src/docs/content/en/tiles/*.md` and `src/docs/content/en/patterns/*.md`. Stripped frontmatter.
- Rewrote `src/docs/docs-registry.ts`: replaced 38 individual `?raw` imports with 4 imports: core manifest from `@mindcraft-lang/core/docs`, core content from `@mindcraft-lang/core/docs/en`, app manifest from `./manifest`, app content via Vite `import.meta.glob("./content/en/**/*.md", { query: "?raw", import: "default", eager: true })`. Maps manifests + content into `DocsEntries` and registers into `DocsRegistry`.

**UI package (`packages/ui`):**

- Deleted `load-docs-entries.ts` and `parse-frontmatter.ts`. These were superseded by the manifest + content map approach and are no longer needed. Removed their barrel exports from `index.ts`.

### Post-Phase 3 -- Accessibility and focus management fixes

**Problem:** The docs sidebar rendered inside `#root` while the brain editor dialog portals to `<body>`. Radix Dialog's modal `FocusScope` trapped Tab cycling within the dialog, preventing keyboard navigation to the sidebar.

**Fixes applied:**

- **Non-modal dialog when docs open:** `BrainEditorDialog` sets `modal={!isDocsOpen}`. When the sidebar is visible, the dialog becomes non-modal, disabling `FocusScope` trapping so Tab can reach the sidebar. Added `onInteractOutside`, `onPointerDownOutside`, and `onFocusOutside` handlers calling `preventDefault()` to prevent accidental dismissal.
- **Standalone overlay backdrop:** Radix does not render `DialogOverlay` in non-modal mode. Added a standalone `<div className="fixed inset-0 z-50 bg-black/80">` that renders when `isOpen && isDocsOpen` to preserve the dimming effect.
- **Auto-focus search on open:** `DocsSidebar` uses `useRef<HTMLInputElement>` threaded through `PanelContent` -> `DocsPanelContent` -> `SearchBar`. A `useEffect` calls `requestAnimationFrame(() => searchRef.current?.focus())` when the sidebar opens.
- **Portaled sidebar to `document.body`:** Moved the desktop `<aside>` and mobile panel rendering through `createPortal(_, document.body)`. This places the sidebar at the same DOM level as dialog portals, so Tab naturally flows between dialog and sidebar without sentinel elements or focus bridge hacks. Added `inert={!isOpen || undefined}` to prevent the off-screen (translated) panel from participating in the tab order when closed.
- **Deleted `FocusBridge.tsx`:** An initial approach using invisible focus sentinel elements was abandoned in favor of the portal strategy, which is decoupled from the brain editor and works when the docs panel is used independently.

**Brain fence content format fix:** All 16 app content markdown files (`apps/sim/src/docs/content/en/tiles/*.md` and `patterns/*.md`) used a non-existent `WHEN:/DO:` text format inside brain fences. `BrainCodeBlock.tsx` expects JSON arrays. Converted all fences to the correct format, e.g., `[{"when":["tile.sensor->sensor.see","tile.modifier->modifier.carnivore"],"do":["tile.actuator->actuator.move"]}]`.

**Known limitation:** Tab cycling through all sidebar controls then continues to the dialog, where Radix's non-modal behavior cycles within the dialog content. Bidirectional Tab flow (dialog -> sidebar -> dialog) is not yet seamless. Deferred to Post-Phase 4.
