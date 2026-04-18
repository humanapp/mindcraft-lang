---
applyTo: "packages/bridge-app/**"
---

<!-- Last reviewed: 2026-04-02 -->

# bridge-app -- Rules & Patterns

App-role client for the Mindcraft bridge. Wraps `bridge-client` with app-specific
behavior: automatic join code management and the `"app"` WebSocket path. Apps (e.g.
`apps/sim`) depend on this package rather than using `bridge-client` directly.

## Build & Scripts

```
npm run build      # tsc --build (outputs to dist/)
npm run typecheck  # tsc --noEmit
npm run check      # biome check --write
```

No test files in this package. After changes, rebuild (`npm run build`) so downstream
consumers see updated types.

## Source Layout

```
src/
  index.ts           # barrel (all public exports)
  app-project.ts     # AppProject class (extends Project with app-role behavior)
```

## Key Exports

- `AppProject` -- extends `Project<AppClientMessage, AppServerMessage>` from
  `bridge-client`. Hardcodes `wsPath: "app"`. Manages join code state from
  `session:welcome` and `session:joinCode` messages.
- `AppProjectOptions` -- simplified options interface (appName,
  bridgeUrl, filesystem). Omits `wsPath` and generic type parameters.

## AppProject

- Extends `Project` parameterized with app-role message types from `bridge-protocol`.
- Constructor maps `AppProjectOptions` to `ProjectOptions`, injecting `wsPath: "app"`.
- Join code lifecycle: listens for `session:welcome` and `session:joinCode` on the
  session. Exposes `joinCode` getter and `onJoinCodeChange(fn)` subscriber (returns
  unsubscribe function). Deduplicates -- won't fire if value unchanged.

## Rules

- Thin wrapper package. App-role logic only; generic client logic belongs in
  `bridge-client`. Message types and schemas belong in `bridge-protocol`.
- All exports go through `src/index.ts`. Consumers import from
  `@mindcraft-lang/bridge-app`.
- Use `import type` for type-only imports.
- All unsubscribe functions return `() => void`.
