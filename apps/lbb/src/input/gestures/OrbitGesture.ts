import * as THREE from "three";
import type { GestureHandler, PointerInput, WheelHandler } from "@/input/types";

const _worldUp = new THREE.Vector3(0, 1, 0);

const MIN_POLAR = 0.02;
const MAX_POLAR = Math.PI - 0.02;
const MIN_DISTANCE = 2;
const MAX_DISTANCE = 1000;
const ORBIT_SENSITIVITY = 0.005;
const DOLLY_FACTOR = 0.001;
const DAMPING_FACTOR = 0.1;
const DAMPING_STOP = 0.00005;

/**
 * Orbit gesture: rotates the camera around a world-space pivot point while
 * keeping that pivot stationary on screen.
 *
 * Math: applying the same rotation R to both the camera position (around the
 * pivot) and the camera orientation quaternion leaves the pivot's projected
 * screen coordinates unchanged. Proof: pivot in camera-local space
 *   = inv(R*q) * (P - (pivot + R*(cam-pivot)))
 *   = inv(q) * (P - cam)   (R cancels out)
 * which is identical to the pre-rotation expression.
 *
 * Also implements WheelHandler for dolly (zoom) independent of drag state.
 *
 */
export class OrbitGesture implements GestureHandler, WheelHandler {
  private readonly pivot = new THREE.Vector3(128, 16, 128);
  private lastScreenX = 0;
  private lastScreenY = 0;
  private isDragging = false;
  private azimuthVelocity = 0;
  private elevationVelocity = 0;

  // Per-instance scratch objects — avoids per-frame allocations.
  private readonly _ptc = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _dir = new THREE.Vector3();
  private readonly _q = new THREE.Quaternion();
  private readonly _q2 = new THREE.Quaternion();

  constructor(
    private readonly camera: THREE.Camera,
    private readonly reroute: (input: PointerInput) => GestureHandler | null
  ) {}

  getPivot(): THREE.Vector3 {
    return this.pivot;
  }

  translatePivot(offset: THREE.Vector3): void {
    this.pivot.add(offset);
  }

  begin(input: PointerInput): void {
    if (input.worldPos !== null) {
      this.pivot.set(input.worldPos[0], input.worldPos[1], input.worldPos[2]);
    }
    this.lastScreenX = input.screenX;
    this.lastScreenY = input.screenY;
    this.azimuthVelocity = 0;
    this.elevationVelocity = 0;
    this.isDragging = true;
  }

  move(input: PointerInput): void {
    const dx = input.screenX - this.lastScreenX;
    const dy = input.screenY - this.lastScreenY;
    this.lastScreenX = input.screenX;
    this.lastScreenY = input.screenY;
    this.azimuthVelocity = -dx * ORBIT_SENSITIVITY;
    this.elevationVelocity = dy * ORBIT_SENSITIVITY;
    this.applyOrbit(this.azimuthVelocity, this.elevationVelocity);
  }

  end(_input: PointerInput): void {
    this.isDragging = false;
    // Velocity is preserved so update() can continue damping after release.
  }

  modifierChanged(input: PointerInput): GestureHandler | null {
    if (!input.modifiers.shift) {
      this.isDragging = false;
      this.azimuthVelocity = 0;
      this.elevationVelocity = 0;
      return this.reroute(input);
    }
    return this;
  }

  onWheel(deltaY: number): void {
    const distance = this.camera.position.distanceTo(this.pivot);
    const newDist = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, distance * (1 + deltaY * DOLLY_FACTOR)));
    this._dir.subVectors(this.camera.position, this.pivot).normalize();
    this.camera.position.copy(this.pivot).addScaledVector(this._dir, newDist);
  }

  /** Call from useFrame to apply post-release damping. */
  update(): void {
    if (this.isDragging) return;
    if (Math.abs(this.azimuthVelocity) < DAMPING_STOP && Math.abs(this.elevationVelocity) < DAMPING_STOP) {
      this.azimuthVelocity = 0;
      this.elevationVelocity = 0;
      return;
    }
    this.applyOrbit(this.azimuthVelocity, this.elevationVelocity);
    this.azimuthVelocity *= 1 - DAMPING_FACTOR;
    this.elevationVelocity *= 1 - DAMPING_FACTOR;
  }

  private applyOrbit(azimuth: number, elevation: number): void {
    this._ptc.subVectors(this.camera.position, this.pivot);

    // Azimuth: rotate around world Y.
    this._q.setFromAxisAngle(_worldUp, azimuth);
    this._ptc.applyQuaternion(this._q);
    this.camera.quaternion.premultiply(this._q);

    // Elevation: rotate around the camera's current right axis.
    this._right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const polar = Math.acos(Math.max(-1, Math.min(1, this._dir.copy(this._ptc).normalize().dot(_worldUp))));
    let clampedEl = elevation;
    if (elevation > 0 && polar >= MAX_POLAR) clampedEl = 0;
    if (elevation < 0 && polar <= MIN_POLAR) clampedEl = 0;
    if (clampedEl !== 0) {
      this._q2.setFromAxisAngle(this._right, clampedEl);
      this._ptc.applyQuaternion(this._q2);
      this.camera.quaternion.premultiply(this._q2);
    }

    this.camera.position.copy(this.pivot).add(this._ptc);
  }
}
