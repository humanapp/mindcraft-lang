import type { GestureHandler, PointerInput } from "./types";

export class GestureRouter {
  private planeOrbit: GestureHandler | null = null;
  private planeDollyPan: GestureHandler | null = null;
  private getSpaceHeld: () => boolean = () => false;

  constructor(
    private readonly sculpt: GestureHandler,
    private readonly orbit: GestureHandler,
    private readonly dollyPan: GestureHandler
  ) {}

  setPlaneGestures(planeOrbit: GestureHandler, planeDollyPan: GestureHandler, getSpaceHeld: () => boolean): void {
    this.planeOrbit = planeOrbit;
    this.planeDollyPan = planeDollyPan;
    this.getSpaceHeld = getSpaceHeld;
  }

  pick(input: PointerInput): GestureHandler | null {
    if (input.button !== 0) return null;

    if (this.getSpaceHeld() && this.planeOrbit && this.planeDollyPan) {
      if (input.modifiers.ctrl || input.modifiers.meta) return this.planeDollyPan;
      if (input.modifiers.shift) return this.planeOrbit;
      return null;
    }

    if (input.modifiers.ctrl || input.modifiers.meta) return this.dollyPan;
    if (input.modifiers.shift) return this.orbit;
    return this.sculpt;
  }
}
