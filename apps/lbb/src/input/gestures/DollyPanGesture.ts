import * as THREE from "three";
import type { GestureHandler, PointerInput } from "@/input/types";

const PAN_SENSITIVITY = 0.002;
const DRAG_DOLLY_FACTOR = 0.005;
const MIN_DISTANCE = 2;
const MAX_DISTANCE = 1000;

/**
 * DollyPan gesture: Ctrl/Cmd + left drag.
 *
 * Horizontal drag: pans the camera left/right along its local X axis.
 *   Both the camera position and the orbit pivot are translated by the same
 *   world-space offset so that subsequent orbits remain centered correctly.
 *
 * Vertical drag: dollies the camera toward/away from the orbit pivot along
 *   the camera-to-pivot axis. Pan scale is proportional to camera distance so
 *   the movement feels constant in angular terms regardless of zoom level.
 */
export class DollyPanGesture implements GestureHandler {
  private lastScreenX = 0;
  private lastScreenY = 0;
  private readonly _anchor = new THREE.Vector3();
  private hasAnchor = false;

  private readonly _right = new THREE.Vector3();
  private readonly _forward = new THREE.Vector3();
  private readonly _offset = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.Camera,
    private readonly getPivot: () => THREE.Vector3,
    private readonly translatePivot: (offset: THREE.Vector3) => void,
    private readonly reroute: (input: PointerInput) => GestureHandler | null
  ) {}

  begin(input: PointerInput): void {
    this.lastScreenX = input.screenX;
    this.lastScreenY = input.screenY;
    if (input.worldPos !== null) {
      this._anchor.set(input.worldPos[0], input.worldPos[1], input.worldPos[2]);
      this.hasAnchor = true;
    } else {
      this.hasAnchor = false;
    }
  }

  move(input: PointerInput): void {
    const dx = input.screenX - this.lastScreenX;
    const dy = input.screenY - this.lastScreenY;
    this.lastScreenX = input.screenX;
    this.lastScreenY = input.screenY;
    if (dx !== 0) this.applyPan(dx);
    if (dy !== 0) this.applyDolly(dy);
  }

  end(_input: PointerInput): void {}

  modifierChanged(input: PointerInput): GestureHandler | null {
    if (!input.modifiers.ctrl && !input.modifiers.meta) return this.reroute(input);
    return this;
  }

  private applyPan(dx: number): void {
    const distance = this.camera.position.distanceTo(this.getPivot());
    this._right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this._offset.copy(this._right).multiplyScalar(-dx * distance * PAN_SENSITIVITY);
    this.camera.position.add(this._offset);
    this.translatePivot(this._offset);
  }

  private applyDolly(dy: number): void {
    const target = this.hasAnchor ? this._anchor : this.getPivot();
    const distance = this.camera.position.distanceTo(target);
    const newDist = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, distance * (1 + dy * DRAG_DOLLY_FACTOR)));
    this._forward.subVectors(this.camera.position, target).normalize();
    this.camera.position.copy(target).addScaledVector(this._forward, newDist);
  }
}
