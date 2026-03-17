import type { GestureRouter } from "./GestureRouter";
import type { GestureHandler, ModifierState, PointerInput, WheelHandler } from "./types";

/**
 * Central input dispatcher.
 *
 * Owns all raw DOM event listeners on the canvas. Translates them into typed
 * PointerInput values and routes them to the active GestureHandler. Handles
 * mid-drag modifier changes by calling modifierChanged() and swapping handlers
 * without requiring a pointer-up/down cycle.
 *
 * setPointerCapture is called on every primary-button press so that
 * pointermove and pointerup are delivered reliably even when the pointer
 * leaves the canvas.
 */
export class InputManager {
  private activeHandler: GestureHandler | null = null;
  private isDown = false;
  private lastScreenX = 0;
  private lastScreenY = 0;
  private modifiers: ModifierState = { shift: false, ctrl: false, meta: false, alt: false };
  private cachedRect: DOMRect | null = null;

  constructor(
    private readonly domElement: HTMLElement,
    private readonly router: GestureRouter,
    private readonly getWorldPos: () => readonly [number, number, number] | null,
    private readonly wheelHandler: WheelHandler
  ) {
    domElement.addEventListener("pointerdown", this.onPointerDown);
    domElement.addEventListener("pointermove", this.onPointerMove);
    domElement.addEventListener("pointerup", this.onPointerUp);
    domElement.addEventListener("pointercancel", this.onPointerCancel);
    domElement.addEventListener("wheel", this.onWheel, { passive: true });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  dispose(): void {
    if (this.isDown && this.activeHandler) {
      this.activeHandler.end(this.makeInput(this.lastScreenX, this.lastScreenY, 0));
    }
    this.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.domElement.removeEventListener("pointermove", this.onPointerMove);
    this.domElement.removeEventListener("pointerup", this.onPointerUp);
    this.domElement.removeEventListener("pointercancel", this.onPointerCancel);
    this.domElement.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  private makeInput(screenX: number, screenY: number, button: number): PointerInput {
    const rect = this.cachedRect ?? this.domElement.getBoundingClientRect();
    const ndcX = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((screenY - rect.top) / rect.height) * 2 + 1;
    return {
      screenX,
      screenY,
      ndcX,
      ndcY,
      worldPos: this.getWorldPos(),
      modifiers: this.modifiers,
      button,
    };
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.isDown = true;
    this.lastScreenX = e.clientX;
    this.lastScreenY = e.clientY;
    this.modifiers = { shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey };
    this.cachedRect = this.domElement.getBoundingClientRect();
    this.domElement.setPointerCapture(e.pointerId);
    const input = this.makeInput(e.clientX, e.clientY, e.button);
    this.activeHandler = this.router.pick(input);
    this.activeHandler?.begin(input);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    this.lastScreenX = e.clientX;
    this.lastScreenY = e.clientY;
    if (!this.isDown || !this.activeHandler) return;
    const input = this.makeInput(e.clientX, e.clientY, 0);
    this.activeHandler.move(input);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.isDown) return;
    this.finishDrag(e.clientX, e.clientY, e.button);
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (!this.isDown) return;
    this.finishDrag(e.clientX, e.clientY, 0);
  };

  private finishDrag(clientX: number, clientY: number, button: number): void {
    this.isDown = false;
    const input = this.makeInput(clientX, clientY, button);
    this.cachedRect = null;
    this.activeHandler?.end(input);
    this.activeHandler = null;
  }

  private readonly onWheel = (e: WheelEvent): void => {
    this.wheelHandler.onWheel(e.deltaY);
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.handleKeyChange(e);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.handleKeyChange(e);
  };

  private handleKeyChange(e: KeyboardEvent): void {
    const next: ModifierState = { shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey };
    const changed =
      next.shift !== this.modifiers.shift ||
      next.ctrl !== this.modifiers.ctrl ||
      next.meta !== this.modifiers.meta ||
      next.alt !== this.modifiers.alt;
    if (!changed) return;
    this.modifiers = next;
    if (!this.isDown || !this.activeHandler) return;
    const input = this.makeInput(this.lastScreenX, this.lastScreenY, 0);
    const nextHandler = this.activeHandler.modifierChanged(input);
    if (nextHandler !== this.activeHandler) {
      this.activeHandler = nextHandler;
      nextHandler?.begin(input);
    }
  }
}
