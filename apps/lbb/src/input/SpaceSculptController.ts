import type { SculptGesture } from "./gestures/SculptGesture";
import type { PointerInput } from "./types";

function isTypingTarget(el: Element | null): boolean {
  if (el === null) return false;
  const tag = (el as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (el as HTMLElement).isContentEditable;
}

const NO_MODIFIERS = { shift: false, ctrl: false, meta: false, alt: false } as const;

function syntheticInput(worldPos: readonly [number, number, number] | null): PointerInput {
  return { screenX: 0, screenY: 0, worldPos, modifiers: NO_MODIFIERS, button: 0 };
}

/**
 * Drives SculptGesture via the Spacebar, making it equivalent to a primary
 * mouse button press over terrain.
 *
 * Space down -> begin() with current hover position.
 * Each frame while held -> move() to keep lastWorldPos in sync with the mouse.
 * Space up -> end() to commit the stroke.
 *
 * Call update() every frame and wire listen()/dispose() with the InputManager
 * lifecycle.
 */
export class SpaceSculptController {
  private spaceHeld = false;

  constructor(
    private readonly sculpt: SculptGesture,
    private readonly getHoverWorldPos: () => readonly [number, number, number] | null
  ) {}

  listen(): void {
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
    window.addEventListener("keyup", this.onKeyUp, { capture: true });
  }

  dispose(): void {
    if (this.spaceHeld) {
      this.sculpt.end(syntheticInput(null));
    }
    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    window.removeEventListener("keyup", this.onKeyUp, { capture: true });
  }

  update(): void {
    if (!this.spaceHeld) return;
    const worldPos = this.getHoverWorldPos();
    this.sculpt.move(syntheticInput(worldPos));
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== "Space") return;
    if (isTypingTarget(document.activeElement)) return;
    e.preventDefault();
    if (this.spaceHeld) return;
    this.spaceHeld = true;
    const worldPos = this.getHoverWorldPos();
    this.sculpt.begin(syntheticInput(worldPos));
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.code !== "Space") return;
    if (!this.spaceHeld) return;
    this.spaceHeld = false;
    this.sculpt.end(syntheticInput(this.getHoverWorldPos()));
  };
}
