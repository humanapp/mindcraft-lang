import * as THREE from "three";

const SPEED = 1;
const LERP_ACCEL = 12;
const LERP_DECEL = 10;

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _target = new THREE.Vector3();

function isTypingTarget(el: Element | null): boolean {
  if (el === null) return false;
  const tag = (el as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (el as HTMLElement).isContentEditable;
}

/**
 * Translates the camera (and orbit pivot) in the horizontal plane in response
 * to WASD keys. Movement speed scales with the camera-to-pivot distance so
 * that panning feels consistent at all zoom levels.
 *
 * Call update(delta) each frame. Attach/detach DOM listeners with the
 * listen() / dispose() pair.
 */
export class WasdController {
  private readonly keys = { w: false, a: false, s: false, d: false, q: false, e: false };
  private readonly velocity = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.Camera,
    private readonly translatePivot: (offset: THREE.Vector3) => void
  ) {}

  listen(): void {
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
    window.addEventListener("keyup", this.onKeyUp, { capture: true });
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    window.removeEventListener("keyup", this.onKeyUp, { capture: true });
  }

  update(delta: number): void {
    const { w, a, s, d, q, e } = this.keys;
    const anyKey = w || a || s || d || q || e;
    if (!anyKey && this.velocity.lengthSq() < 1e-10) return;
    if (isTypingTarget(document.activeElement)) {
      this.velocity.set(0, 0, 0);
      return;
    }

    const fwd = (w ? 1 : 0) - (s ? 1 : 0);
    const str = (d ? 1 : 0) - (a ? 1 : 0);
    const vert = (e ? 1 : 0) - (q ? 1 : 0);

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
    const hLen = _target.length();
    const totalAxes = (hLen > 0 ? 1 : 0) + (vert !== 0 ? 1 : 0);
    if (hLen > 0) _target.divideScalar(hLen);
    if (totalAxes > 1) _target.multiplyScalar(1 / Math.SQRT2);
    _target.y += vert * (totalAxes > 1 ? 1 / Math.SQRT2 : 1);

    const elevation = Math.max(1, this.camera.position.y);
    _target.multiplyScalar(elevation * SPEED);

    const t = 1 - Math.exp(-(anyKey ? LERP_ACCEL : LERP_DECEL) * delta);
    this.velocity.lerp(_target, t);

    _move.copy(this.velocity).multiplyScalar(delta);
    this.camera.position.add(_move);
    this.translatePivot(_move);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isTypingTarget(document.activeElement)) return;
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
      case "KeyQ":
        this.keys.q = true;
        break;
      case "KeyE":
        this.keys.e = true;
        break;
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
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
      case "KeyQ":
        this.keys.q = false;
        break;
      case "KeyE":
        this.keys.e = false;
        break;
    }
  };
}
