---
applyTo: 'packages/core/**'
---
<!-- Last reviewed: 2026-02-23 -->
<!-- Sync: rules duplicated in copilot-instructions.md "Multi-Target Core" section -->

# Core Package -- Multi-Target Build & Conventions

**packages/core is a multi-target project** that builds for:
- Roblox-TS (Luau compilation)
- Node.js (CommonJS)
- ESM (ES Modules)

When making changes to `packages/core`:
- Consider platform compatibility across all three targets
- Avoid platform-specific APIs or Node.js-only features
- Test builds with `npm run build` to verify all targets compile successfully
- Be mindful of import/export patterns that work across all platforms
- Remember that Roblox-TS has different constraints than Node.js/browser environments
- **Prefer `List` and `Dict` containers** from `packages/core/src/platform` over native `Array` and `Map` for cross-platform compatibility
- Use `unknown` or `never` type instead of `any` to ensure Roblox compatibility
- After making changes, ensure the project builds cleanly (`npm run build`)

## Testing

**Run tests:** `cd packages/core && npm test`

Tests use `node:test` and `node:assert/strict` (Node.js built-ins, zero package dependencies). Test files are colocated with the code they test, using the `*.spec.ts` naming convention. All three build tsconfigs (`tsconfig.node.json`, `tsconfig.esm.json`, `tsconfig.rbx.json`) exclude `**/*.spec.ts`, so test files do not affect any build target.

The test runner is `tsx --test` (tsx is a devDependency). A `pretest` script runs `npm run build:node` before tests execute, because spec files use package imports (`@mindcraft-lang/core/brain`, etc.) that resolve to the built `dist/node/` output. This is required because platform modules (e.g., `platform/list.ts`) use ambient declarations with `.node.ts` implementations that only resolve after the build step copies them into place.

Current test files:
- `src/brain/compiler/conversion.spec.ts` -- implicit type conversion tests
- `src/brain/compiler/parser.spec.ts` -- brain tile parser tests
- `src/brain/language-service/tile-suggestions.spec.ts` -- tile suggestion language service tests
- `src/brain/runtime/brain.spec.ts` -- brain execution tests
- `src/brain/runtime/vm.spec.ts` -- bytecode VM tests
- `src/platform/stream.spec.ts` -- binary stream tests

When adding new tests, follow this pattern:
- Use `describe`/`test`/`before` from `node:test` and `assert` from `node:assert/strict`
- Use package imports (`@mindcraft-lang/core`, `@mindcraft-lang/core/brain`, etc.) not relative imports to platform modules
- Place spec files next to the code they test (e.g., `parser.spec.ts` beside `parser.ts`)

## Roblox-TS Gotchas

The Roblox-TS compiler (`rbxtsc`) has restrictions beyond standard TypeScript. Watch for these:

1. **No global `Error`**: Use `import { Error } from "../../platform/error"` instead of the global `Error` class.
2. **No `typeof` operator**: Use `TypeUtils.isString()`, `TypeUtils.isNumber()`, `TypeUtils.isBoolean()` from `platform/types.ts` instead of `typeof x === "string"` etc.
3. **Luau reserved keywords cannot be used as identifiers**: This includes function names, parameter names, and variable names. Reserved words include: `and`, `break`, `do`, `else`, `elseif`, `end`, `false`, `for`, `function`, `if`, `in`, `local`, `nil`, `not`, `or`, `repeat`, `return`, `then`, `true`, `until`, `while`. For example, a function named `repeat()` or a parameter named `then` will fail the rbx build.
4. **No `globalThis`**: Platform-specific implementations in `.node.ts` files can use it, but shared code in `.ts` files cannot.

## Platform-Specific Implementation Pattern

Several modules in `packages/core/src/platform` use a platform-specific implementation pattern:

**File Structure:**
- `module.ts` - Contains TypeScript declarations, interfaces, and `declare` statements for classes/functions
- `module.node.ts` - Contains Node.js/browser implementations (uses `Uint8Array`, standard Web APIs)
- `module.rbx.ts` - Contains Roblox implementations (uses `buffer`, Roblox-specific APIs)

**Build Process:**
The post-build scripts (`scripts/post-build-node.js`, `post-build-esm.js`, `post-build-rbx.js`) automatically:
1. Compile both `.ts` and `.node.ts` (or `.rbx.ts`) files
2. Copy the platform-specific implementation files, removing the suffix:
   - `module.node.{js,d.ts,d.ts.map}` -> `module.{js,d.ts,d.ts.map}` (for Node/ESM)
   - `module.rbx.{luau,d.ts,d.ts.map}` -> `module.{luau,d.ts,d.ts.map}` (for Roblox)

**Important Implementation Rules:**

1. **Declarations in `.ts` file must be complete**: Since the `.d.ts` file from the base module gets overwritten by the platform-specific `.d.ts`, ensure all exported functions, classes, and types are declared with `declare` or `export declare` in the base `.ts` file.

2. **Use `declare` for runtime implementations**: Functions/classes that will be implemented in platform files should use `declare` or `export declare` in the base `.ts` file. Example:
   ```typescript
   // module.ts
   export declare function platformSpecificFunc(param: SomeType): ReturnType;
   
   // module.node.ts  
   export function platformSpecificFunc(param: SomeType): ReturnType {
     // Node implementation
   }
   ```

3. **Constructor signatures**: If a class is implemented in platform files, declare its constructor in the base `.ts` file:
   ```typescript
   export declare class MyClass {
     constructor(param?: OptionalType);
     // ... method declarations
   }
   ```

4. **Never use `any` type**: Roblox's type system chokes on `any`. Use `unknown` or proper types instead (prefer proper types).

5. **Platform-specific types**: Use `unknown` in base `.ts` declarations when the actual type differs by platform (e.g., `Uint8Array` in Node vs `buffer` in Roblox). Only use `unknown` when necessary.

6. **Don't cross-reference platform files**: The base `.ts` file should NOT import from `.node.ts` or `.rbx.ts` files, as these are excluded from different build configurations.

**Current modules using this pattern:**

Most modules in `platform/` use this pattern, including `dict`, `error`, `list`, `logger`, `math`, `stream`, `string`, `task`, `time`, `types`, `uniqueset`, `vector2`, and `vector3`.
