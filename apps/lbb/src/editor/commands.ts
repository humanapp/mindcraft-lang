import type { TerrainPatch } from "@/world/terrain/edit";
import { useWorldStore } from "@/world/world-store";
import type { Command } from "./undo-stack";

export class TerrainPatchCommand implements Command {
  private patches: TerrainPatch[];
  private clamp: boolean;

  constructor(patches: TerrainPatch[], clamp: boolean) {
    this.patches = patches;
    this.clamp = clamp;
  }

  execute(): void {
    const apply = useWorldStore.getState().applyFieldValues;
    apply(
      this.patches.map((p) => ({ chunkId: p.chunkId, fieldIndex: p.fieldIndex, value: p.after })),
      this.clamp
    );
  }

  undo(): void {
    const { applyFieldValues, recomputeDensityRange } = useWorldStore.getState();
    applyFieldValues(
      this.patches.map((p) => ({ chunkId: p.chunkId, fieldIndex: p.fieldIndex, value: p.before })),
      this.clamp
    );
    recomputeDensityRange();
  }
}

// Future command types:
// export class EntityCreateCommand implements Command { ... }
// export class EntityDeleteCommand implements Command { ... }
// export class EntityTransformCommand implements Command { ... }
// export class PropertyChangeCommand implements Command { ... }
// export class BrainEditCommand implements Command { ... }
