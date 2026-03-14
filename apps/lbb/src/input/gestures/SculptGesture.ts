import type { GestureHandler, PointerInput } from "../types";

// Cap dt to avoid large jumps after tab-away or debugger pauses.
const MAX_DT = 1 / 15;

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
 */
export class SculptGesture implements GestureHandler {
  private isActive = false;
  private lastWorldPos: readonly [number, number, number] | null = null;

  constructor(
    private readonly callbacks: SculptCallbacks,
    private readonly reroute: (input: PointerInput) => GestureHandler | null
  ) {}

  begin(input: PointerInput): void {
    if (input.worldPos === null) return;
    this.isActive = true;
    this.lastWorldPos = input.worldPos;
    this.callbacks.setPointerDown(true);
  }

  move(input: PointerInput): void {
    if (!this.isActive || input.worldPos === null) return;
    this.lastWorldPos = input.worldPos;
  }

  tick(dt: number): void {
    if (!this.isActive || this.lastWorldPos === null) return;
    this.callbacks.applyBrush(this.lastWorldPos, Math.min(dt, MAX_DT));
  }

  end(_input: PointerInput): void {
    if (!this.isActive) return;
    this.isActive = false;
    this.lastWorldPos = null;
    this.callbacks.setPointerDown(false);
    this.callbacks.commitStroke();
  }

  modifierChanged(input: PointerInput): GestureHandler | null {
    if (input.modifiers.shift || input.modifiers.ctrl || input.modifiers.meta) {
      if (this.isActive) {
        this.isActive = false;
        this.lastWorldPos = null;
        this.callbacks.setPointerDown(false);
        this.callbacks.commitStroke();
      }
      return this.reroute(input);
    }
    return this;
  }
}
