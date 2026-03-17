import * as THREE from "three";
import type { WorkingPlane } from "@/editor/working-plane";
import type { GestureHandler, PointerInput } from "@/input/types";

const PAN_SENSITIVITY = 0.002;
const NORMAL_DRAG_FACTOR = 0.005;

export class PlanePanGesture implements GestureHandler {
  private lastScreenX = 0;
  private lastScreenY = 0;

  private readonly _right = new THREE.Vector3();
  private readonly _up = new THREE.Vector3();
  private readonly _offset = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.Camera,
    private readonly plane: WorkingPlane,
    private readonly onChanged: () => void,
    private readonly reroute: (input: PointerInput) => GestureHandler | null
  ) {}

  begin(input: PointerInput): void {
    this.lastScreenX = input.screenX;
    this.lastScreenY = input.screenY;
  }

  move(input: PointerInput): void {
    const dx = input.screenX - this.lastScreenX;
    const dy = input.screenY - this.lastScreenY;
    this.lastScreenX = input.screenX;
    this.lastScreenY = input.screenY;

    if (input.modifiers.shift) {
      this.applyNormalMove(dy);
      return;
    }

    const distance = this.camera.position.distanceTo(this.plane.position);
    this._right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);

    this._offset
      .set(0, 0, 0)
      .addScaledVector(this._right, dx * distance * PAN_SENSITIVITY)
      .addScaledVector(this._up, -dy * distance * PAN_SENSITIVITY);

    this.plane.translate(this._offset);
    this.onChanged();
  }

  end(_input: PointerInput): void {}

  modifierChanged(input: PointerInput): GestureHandler | null {
    if (!input.modifiers.ctrl && !input.modifiers.meta) return this.reroute(input);
    return this;
  }

  private applyNormalMove(dy: number): void {
    const distance = this.camera.position.distanceTo(this.plane.position);
    this.plane.moveAlongNormal(-dy * distance * NORMAL_DRAG_FACTOR);
    this.onChanged();
  }
}
