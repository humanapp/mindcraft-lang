import type { GestureHandler, PointerInput } from "./types";

/**
 * Maps a pointer-down event to the appropriate GestureHandler based on which
 * button was pressed and which modifier keys are held.
 *
 * This is the single place to extend when adding new gestures or tool modes.
 */
export class GestureRouter {
  constructor(
    private readonly sculpt: GestureHandler,
    private readonly orbit: GestureHandler,
    private readonly dollyPan: GestureHandler
  ) {}

  pick(input: PointerInput): GestureHandler | null {
    if (input.button !== 0) return null;
    if (input.modifiers.ctrl || input.modifiers.meta) return this.dollyPan;
    if (input.modifiers.shift) return this.orbit;
    return this.sculpt;
  }
}
