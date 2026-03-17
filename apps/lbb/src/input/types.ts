export interface ModifierState {
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
}

export interface PointerInput {
  readonly screenX: number;
  readonly screenY: number;
  /** NDC coordinates in [-1, 1] for both axes, suitable for camera raycasting. */
  readonly ndcX: number;
  readonly ndcY: number;
  /** World-space terrain hit, or null if the pointer is not over terrain. */
  readonly worldPos: readonly [number, number, number] | null;
  readonly modifiers: ModifierState;
  readonly button: number;
}

/**
 * A stateful handler that owns an in-progress pointer drag gesture.
 *
 * Lifetime: begin -> move* -> (modifierChanged -> begin on new handler)* -> end
 *
 * The handler is responsible for its own cleanup inside modifierChanged when
 * returning a different handler. InputManager does NOT call end() before
 * calling begin() on the incoming handler.
 */
export interface GestureHandler {
  begin(input: PointerInput): void;
  move(input: PointerInput): void;
  /** Called on pointer-up or when InputManager is disposed mid-drag. */
  end(input: PointerInput): void;
  /**
   * Called when modifier keys change during an active drag. The handler should
   * perform any cleanup needed (e.g. commit a stroke) and return the handler
   * that should own the gesture going forward. Returning `this` keeps ownership;
   * returning null releases the gesture (no new begin() is called).
   */
  modifierChanged(input: PointerInput): GestureHandler | null;
}

export interface WheelHandler {
  onWheel(deltaY: number): void;
}
