import * as THREE from "three";
import type { WorkingPlane } from "@/editor/working-plane";
import type { GestureHandler, PointerInput } from "@/input/types";

const ROTATE_SENSITIVITY = 0.005;
const _worldUp = new THREE.Vector3(0, 1, 0);

export class PlaneRotateGesture implements GestureHandler {
  private lastScreenX = 0;
  private lastScreenY = 0;
  private readonly _right = new THREE.Vector3();
  private readonly _q = new THREE.Quaternion();

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

    if (dx !== 0) {
      this._q.setFromAxisAngle(_worldUp, -dx * ROTATE_SENSITIVITY);
      this.plane.applyQuaternion(this._q);
    }

    if (dy !== 0) {
      this._right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      this._q.setFromAxisAngle(this._right, dy * ROTATE_SENSITIVITY);
      this.plane.applyQuaternion(this._q);
    }

    this.onChanged();
  }

  end(_input: PointerInput): void {}

  modifierChanged(input: PointerInput): GestureHandler | null {
    if (!input.modifiers.shift) return this.reroute(input);
    return this;
  }
}
