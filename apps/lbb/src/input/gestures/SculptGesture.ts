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
 * non-null). Once active, each move applies the brush at the current terrain
 * hit position. Releasing the pointer or handing off to another gesture
 * commits the stroke via the undo stack.
 *
 * Brush application is time-scaled: each call to applyBrush receives a dt
 * (seconds since the last application, capped at MAX_DT) so brush strength
 * is frame-rate independent.
 */
export class SculptGesture implements GestureHandler {
  private isActive = false;
  private lastApplyTime = 0;

  constructor(
    private readonly callbacks: SculptCallbacks,
    private readonly reroute: (input: PointerInput) => GestureHandler | null
  ) {}

  begin(input: PointerInput): void {
    if (input.worldPos === null) return;
    this.isActive = true;
    this.lastApplyTime = performance.now();
    this.callbacks.setPointerDown(true);
    // First application uses a nominal 60fps frame interval.
    this.callbacks.applyBrush(input.worldPos, 1 / 60);
  }

  move(input: PointerInput): void {
    if (!this.isActive || input.worldPos === null) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastApplyTime) / 1000, MAX_DT);
    this.lastApplyTime = now;
    this.callbacks.applyBrush(input.worldPos, dt);
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
