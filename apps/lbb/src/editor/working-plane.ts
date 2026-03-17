import * as THREE from "three";

const _ray = new THREE.Ray();
const _planeNormal = new THREE.Vector3();
const _defaultUp = new THREE.Vector3(0, 1, 0);

export interface WorkingPlaneState {
  readonly position: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
}

export interface PlaneHit {
  readonly position: THREE.Vector3;
  readonly distance: number;
}

export class WorkingPlane {
  readonly position = new THREE.Vector3(128, 16, 128);
  readonly normal = new THREE.Vector3(0, 0, 1);
  readonly quaternion = new THREE.Quaternion().setFromUnitVectors(_defaultUp, new THREE.Vector3(0, 0, 1));

  private readonly _threePlane = new THREE.Plane();
  private readonly _intersectTarget = new THREE.Vector3();

  setFromPositionAndNormal(position: THREE.Vector3, normal: THREE.Vector3): void {
    this.position.copy(position);
    this.normal.copy(normal).normalize();
    this.quaternion.setFromUnitVectors(_defaultUp, this.normal);
    this.syncPlane();
  }

  translate(offset: THREE.Vector3): void {
    this.position.add(offset);
    this.syncPlane();
  }

  moveAlongNormal(distance: number): void {
    this.position.addScaledVector(this.normal, distance);
    this.syncPlane();
  }

  moveY(distance: number): void {
    this.position.y += distance;
    this.syncPlane();
  }

  applyQuaternion(q: THREE.Quaternion): void {
    this.normal.applyQuaternion(q).normalize();
    this.quaternion.premultiply(q);
    this.syncPlane();
  }

  raycast(origin: THREE.Vector3, direction: THREE.Vector3): PlaneHit | null {
    this.syncPlane();
    _ray.set(origin, direction);
    const t = _ray.distanceToPlane(this._threePlane);
    if (t === null || t < 0) return null;
    _ray.at(t, this._intersectTarget);
    return { position: this._intersectTarget.clone(), distance: t };
  }

  getState(): WorkingPlaneState {
    return {
      position: this.position.clone(),
      normal: this.normal.clone(),
      quaternion: this.quaternion.clone(),
    };
  }

  private syncPlane(): void {
    _planeNormal.copy(this.normal);
    this._threePlane.setFromNormalAndCoplanarPoint(_planeNormal, this.position);
  }
}
