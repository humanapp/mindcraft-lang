import * as THREE from "three";
import { useEditorStore } from "@/editor/editor-store";
import type { WorkingPlane } from "@/editor/working-plane";

const NORMAL_STEP = 2;
const LATERAL_SPEED = 1;
const LERP_ACCEL = 12;
const LERP_DECEL = 10;

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _target = new THREE.Vector3();
const _move = new THREE.Vector3();

function isTypingTarget(el: Element | null): boolean {
  if (el === null) return false;
  const tag = (el as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (el as HTMLElement).isContentEditable;
}

export class WorkingPlaneController {
  private readonly keys = { w: false, a: false, s: false, d: false, r: false, f: false };
  private readonly velocity = new THREE.Vector3();
  private _spaceHeld = false;

  get spaceHeld(): boolean {
    return this._spaceHeld;
  }

  constructor(
    private readonly camera: THREE.Camera,
    private readonly plane: WorkingPlane,
    private readonly onChanged: () => void
  ) {}

  listen(): void {
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
    window.addEventListener("keyup", this.onKeyUp, { capture: true });
  }

  dispose(): void {
    if (this._spaceHeld) {
      this._spaceHeld = false;
      useEditorStore.getState().setSpaceHeld(false);
    }
    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    window.removeEventListener("keyup", this.onKeyUp, { capture: true });
  }

  update(delta: number): void {
    if (!this._spaceHeld) return;

    const { w, a, s, d } = this.keys;
    const anyKey = w || a || s || d;
    if (!anyKey && this.velocity.lengthSq() < 1e-10) return;
    if (isTypingTarget(document.activeElement)) {
      this.velocity.set(0, 0, 0);
      return;
    }

    const fwd = (w ? 1 : 0) - (s ? 1 : 0);
    const str = (d ? 1 : 0) - (a ? 1 : 0);

    this.camera.getWorldDirection(_forward);
    _forward.y = 0;
    const fwdLen = _forward.length();
    if (fwdLen < 1e-6) return;
    _forward.divideScalar(fwdLen);

    _right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    _right.y = 0;
    const rightLen = _right.length();
    if (rightLen < 1e-6) return;
    _right.divideScalar(rightLen);

    _target.set(0, 0, 0).addScaledVector(_forward, fwd).addScaledVector(_right, str);
    if (_target.lengthSq() > 0) _target.normalize();

    const elevation = Math.max(1, this.camera.position.y);
    _target.multiplyScalar(elevation * LATERAL_SPEED);

    const t = 1 - Math.exp(-(anyKey ? LERP_ACCEL : LERP_DECEL) * delta);
    this.velocity.lerp(_target, t);

    _move.copy(this.velocity).multiplyScalar(delta);
    this.plane.translate(_move);
    this.onChanged();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isTypingTarget(document.activeElement)) return;

    if (e.code === "Space") {
      e.preventDefault();
      if (this._spaceHeld) return;
      const planeEnabled = useEditorStore.getState().workingPlaneEnabled;
      if (!planeEnabled) return;
      this._spaceHeld = true;
      useEditorStore.getState().setSpaceHeld(true);
      return;
    }

    if (!this._spaceHeld) return;

    switch (e.code) {
      case "KeyW":
      case "ArrowUp":
        this.keys.w = true;
        e.preventDefault();
        break;
      case "KeyA":
      case "ArrowLeft":
        this.keys.a = true;
        e.preventDefault();
        break;
      case "KeyS":
      case "ArrowDown":
        this.keys.s = true;
        e.preventDefault();
        break;
      case "KeyD":
      case "ArrowRight":
        this.keys.d = true;
        e.preventDefault();
        break;
      case "KeyE":
        this.plane.moveY(NORMAL_STEP);
        this.onChanged();
        e.preventDefault();
        break;
      case "KeyQ":
        this.plane.moveY(-NORMAL_STEP);
        this.onChanged();
        e.preventDefault();
        break;
      case "KeyR":
        this.plane.moveAlongNormal(NORMAL_STEP);
        this.onChanged();
        e.preventDefault();
        break;
      case "KeyF":
        this.plane.moveAlongNormal(-NORMAL_STEP);
        this.onChanged();
        e.preventDefault();
        break;
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "Space") {
      if (!this._spaceHeld) return;
      this._spaceHeld = false;
      this.velocity.set(0, 0, 0);
      this.keys.w = false;
      this.keys.a = false;
      this.keys.s = false;
      this.keys.d = false;
      this.keys.r = false;
      this.keys.f = false;
      useEditorStore.getState().setSpaceHeld(false);
      return;
    }

    if (!this._spaceHeld) return;
    switch (e.code) {
      case "KeyW":
      case "ArrowUp":
        this.keys.w = false;
        break;
      case "KeyA":
      case "ArrowLeft":
        this.keys.a = false;
        break;
      case "KeyS":
      case "ArrowDown":
        this.keys.s = false;
        break;
      case "KeyD":
      case "ArrowRight":
        this.keys.d = false;
        break;
    }
  };
}
