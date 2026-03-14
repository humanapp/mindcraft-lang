import type { GestureHandler, PointerInput } from "../types";

export interface SculptCallbacks {
  applyBrush(worldPos: readonly [number, number, number]): void;
  commitStroke(): void;
  setPointerDown(down: boolean): void;
}

/**
 * Sculpt gesture: applies the terrain brush while the primary button is held.
 *
 * A stroke begins only if the initial pointer-down lands on terrain (worldPos
 * non-null). Once active, each move applies the brush at the current terrain
 * hit position. Releasing the pointer or handing off to another gesture
 * commits the stroke via the undo stack.
 *
 */
export class SculptGesture implements GestureHandler {
  private isActive = false;

  constructor(
    private readonly callbacks: SculptCallbacks,
    private readonly reroute: (input: PointerInput) => GestureHandler | null
  ) {}

  begin(input: PointerInput): void {
    if (input.worldPos === null) return;
    this.isActive = true;
    this.callbacks.setPointerDown(true);
    this.callbacks.applyBrush(input.worldPos);
  }

  move(input: PointerInput): void {
    if (!this.isActive || input.worldPos === null) return;
    this.callbacks.applyBrush(input.worldPos);
  }

  end(_input: PointerInput): void {
    if (!this.isActive) return;
    this.isActive = false;
    this.callbacks.setPointerDown(false);
    this.callbacks.commitStroke();
  }

  modifierChanged(input: PointerInput): GestureHandler | null {
    if (input.modifiers.shift || input.modifiers.ctrl || input.modifiers.meta) {
      if (this.isActive) {
        this.isActive = false;
        this.callbacks.setPointerDown(false);
        this.callbacks.commitStroke();
      }
      return this.reroute(input);
    }
    return this;
  }
}
