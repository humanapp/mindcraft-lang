import type { TerrainPatch } from "../world/terrain/edit";
import { useWorldStore } from "../world/world-store";
import type { Command } from "./undo-stack";

export class TerrainPatchCommand implements Command {
  private patches: TerrainPatch[];

  constructor(patches: TerrainPatch[]) {
    this.patches = patches;
  }

  execute(): void {
    const apply = useWorldStore.getState().applyFieldValues;
    apply(this.patches.map((p) => ({ chunkId: p.chunkId, index: p.index, value: p.after })));
  }

  undo(): void {
    const apply = useWorldStore.getState().applyFieldValues;
    apply(this.patches.map((p) => ({ chunkId: p.chunkId, index: p.index, value: p.before })));
  }
}

// Future command types:
// export class EntityCreateCommand implements Command { ... }
// export class EntityDeleteCommand implements Command { ... }
// export class EntityTransformCommand implements Command { ... }
// export class PropertyChangeCommand implements Command { ... }
// export class BrainEditCommand implements Command { ... }
