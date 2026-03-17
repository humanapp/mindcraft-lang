import { useEditorStore } from "@/editor/editor-store";
import type { GestureHandler, PointerInput } from "@/input/types";

// Cap dt to avoid large jumps after tab-away or debugger pauses.
const MAX_DT = 1 / 15;

// World coordinates map 1:1 to voxel indices.
const VOXEL_SIZE = 1;

export interface SculptCallbacks {
  applyBrush(worldPos: readonly [number, number, number], dt: number): void;
  commitStroke(): void;
  setPointerDown(down: boolean): void;
}

/**
 * Sculpt gesture: applies the terrain brush while the primary button is held.
 *
 * A stroke begins only if the initial pointer-down lands on terrain (worldPos
 * non-null). Once active, brush edits are applied every frame via tick() at
 * the last known terrain hit position, so the brush continues sculpting even
 * when the cursor is stationary. Releasing the pointer or handing off to
 * another gesture commits the stroke via the undo stack.
 *
 * Brush application is time-scaled: tick() receives the R3F frame delta
 * (seconds, capped at MAX_DT) so brush strength is frame-rate independent.
 *
 * Intermediate brush stamps are interpolated along the stroke path so terrain
 * edits form a continuous sweep regardless of cursor speed.
 */
export class SculptGesture implements GestureHandler {
  private isActive = false;
  private lastWorldPos: readonly [number, number, number] | null = null;
  private lastAppliedCenter: readonly [number, number, number] | null = null;

  constructor(
    private readonly callbacks: SculptCallbacks,
    private readonly reroute: (input: PointerInput) => GestureHandler | null
  ) {}

  begin(input: PointerInput): void {
    if (input.worldPos === null) return;
    this.isActive = true;
    this.lastWorldPos = input.worldPos;
    this.lastAppliedCenter = null;
    this.callbacks.setPointerDown(true);
  }

  move(input: PointerInput): void {
    if (!this.isActive || input.worldPos === null) return;
    this.lastWorldPos = input.worldPos;
  }

  tick(dt: number): void {
    if (!this.isActive || this.lastWorldPos === null) return;
    if (useEditorStore.getState().spaceHeld) {
      this.end({
        screenX: 0,
        screenY: 0,
        worldPos: null,
        modifiers: { shift: false, ctrl: false, meta: false, alt: false },
        button: 0,
      });
      return;
    }

    const clampedDt = Math.min(dt, MAX_DT);
    const currentPos = this.lastWorldPos;

    if (this.lastAppliedCenter === null) {
      this.callbacks.applyBrush(currentPos, clampedDt);
      this.lastAppliedCenter = currentPos;
      return;
    }

    const brushRadius = useEditorStore.getState().brush.radius;
    const step = Math.max(brushRadius * 0.2, VOXEL_SIZE * 0.5);

    const dx = currentPos[0] - this.lastAppliedCenter[0];
    const dy = currentPos[1] - this.lastAppliedCenter[1];
    const dz = currentPos[2] - this.lastAppliedCenter[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist <= step) {
      this.callbacks.applyBrush(currentPos, clampedDt);
      this.lastAppliedCenter = currentPos;
      return;
    }

    const count = Math.ceil(dist / step);
    const dtPerStamp = clampedDt / count;

    for (let i = 1; i <= count; i++) {
      const t = i / count;
      const px = this.lastAppliedCenter[0] + dx * t;
      const py = this.lastAppliedCenter[1] + dy * t;
      const pz = this.lastAppliedCenter[2] + dz * t;
      this.callbacks.applyBrush([px, py, pz], dtPerStamp);
    }

    this.lastAppliedCenter = currentPos;
  }

  end(_input: PointerInput): void {
    if (!this.isActive) return;
    this.isActive = false;
    this.lastWorldPos = null;
    this.lastAppliedCenter = null;
    this.callbacks.setPointerDown(false);
    this.callbacks.commitStroke();
  }

  modifierChanged(input: PointerInput): GestureHandler | null {
    if (input.modifiers.shift || input.modifiers.ctrl || input.modifiers.meta) {
      if (this.isActive) {
        this.isActive = false;
        this.lastWorldPos = null;
        this.lastAppliedCenter = null;
        this.callbacks.setPointerDown(false);
        this.callbacks.commitStroke();
      }
      return this.reroute(input);
    }
    return this;
  }
}
