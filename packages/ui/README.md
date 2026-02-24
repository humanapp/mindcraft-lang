# @mindcraft-lang/ui

Shared React UI components for **Mindcraft** web applications. This package provides shadcn/ui primitives and the full brain editor component tree, designed to be consumed by any webapp in the monorepo.

## What's Included

- **UI primitives** (`ui/`) -- shadcn/ui components: Button, Card, Dialog, DropdownMenu, Input, Slider
- **Brain editor** (`brain-editor/`) -- complete visual brain editor with undo/redo, tile picker, print preview
- **Utility library** (`lib/`) -- `cn()` class merge, color manipulation, glass effects

## Usage

This is a **source-only package** -- there is no build step. Consuming apps resolve the source directly via Vite aliases and tsconfig path mappings.

### Vite config

```js
resolve: {
  alias: {
    "@mindcraft-lang/ui": path.resolve(__dirname, "../../packages/ui/src"),
  },
},
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "paths": {
      "@mindcraft-lang/ui": ["../../packages/ui/src/index.ts"],
      "@mindcraft-lang/ui/*": ["../../packages/ui/src/*"]
    }
  }
}
```

### Imports

```typescript
import { Button, Dialog, Slider } from "@mindcraft-lang/ui";
import { BrainEditorDialog, BrainEditorProvider } from "@mindcraft-lang/ui";
import { cn, glassEffect } from "@mindcraft-lang/ui";
```

## Brain Editor Integration

The brain editor is decoupled from app-specific concepts through a context provider. Host apps supply tile visuals, data type icons, and optional custom literal types via `BrainEditorProvider`.

```tsx
import { BrainEditorProvider, BrainEditorDialog } from "@mindcraft-lang/ui";
import type { BrainEditorConfig } from "@mindcraft-lang/ui";

const config: BrainEditorConfig = {
  dataTypeIcons: new Map([...]),   // type ID -> icon URL
  dataTypeNames: new Map([...]),   // type ID -> display name
  isAppVariableFactoryTileId: (id) => ...,
  customLiteralTypes: [...],       // optional app-specific literal types
  getDefaultBrain: () => ...,      // optional factory for new brains
};

<BrainEditorProvider config={config}>
  <BrainEditorDialog brainDef={brain} onBrainChange={setBrain} />
</BrainEditorProvider>
```

See `apps/sim/src/brain-editor-config.tsx` for a working example.

## Package Layout

```
src/
  index.ts                  Top-level barrel export
  lib/
    utils.ts                cn() -- Tailwind class merge
    color.ts                adjustColor(), saturateColor()
    glass-effect.ts         CSS glass/glint effect generator
    index.ts                Barrel
  ui/
    button.tsx              shadcn/ui Button
    card.tsx                shadcn/ui Card
    dialog.tsx              shadcn/ui Dialog
    dropdown-menu.tsx       shadcn/ui DropdownMenu
    input.tsx               shadcn/ui Input
    slider.tsx              shadcn/ui Slider
    index.ts                Barrel
  brain-editor/
    index.ts                Barrel
    types.ts                TileVisual, TileColorDef
    BrainEditorContext.tsx   BrainEditorConfig, BrainEditorProvider, useBrainEditorConfig
    BrainEditorDialog.tsx    Full editor (pages, toolbar, undo/redo)
    BrainPageEditor.tsx      Page rules list with depth flattening
    BrainRuleEditor.tsx      WHEN/DO rule row with glass effects
    BrainTile.tsx            Individual tile button with marquee overflow
    BrainTileEditor.tsx      Tile with dropdown context menu
    BrainTilePickerDialog.tsx  Available tiles grouped by kind
    TileValue.tsx            Renders literal values or variable names
    CreateVariableDialog.tsx   Dialog for naming a new variable
    CreateLiteralDialog.tsx    Dialog for custom literal types
    BrainPrintDialog.tsx     Print preview (visual + text modes)
    BrainPrintView.tsx       Visual print layout
    BrainPrintTextView.tsx   Plain-text print layout
    rule-clipboard.ts        Copy/paste rules
    tile-clipboard.ts        Copy/paste tiles
    tile-badges.ts           Tile badge rendering
    commands/
      BrainCommand.ts        BrainCommand interface + BrainCommandHistory
      PageCommands.ts        Add/Remove/ReplaceLast page commands
      RenameCommands.ts      Rename brain/page commands
      RuleCommands.ts        Add/Delete/Move/Indent/Outdent rule commands
      TileCommands.ts        Add/Insert/Replace/Remove tile commands
      index.ts               Barrel
    hooks/
      useRuleCapabilities.ts   Rule capability detection
      useTileSelection.ts      Tile selection flow + factory handoff
      index.ts                 Barrel
```

## Dependencies

- **@mindcraft-lang/core** -- brain data model, tile definitions, compiler
- **Radix UI** -- Dialog, DropdownMenu, Slider, Slot
- **class-variance-authority + clsx + tailwind-merge** -- styling utilities
- **lucide-react** -- icons
- **React 19** (peer dependency)

## Development

```bash
npm run check      # Biome lint + format check
npm run check:fix  # Auto-fix
```
