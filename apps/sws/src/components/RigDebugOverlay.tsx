// components/RigDebugOverlay.tsx
//
// Debug visualization overlay for the character rig. Rendered as a sibling
// to RigMeshes inside the CharacterRig group. All geometry is updated each
// frame from the physics state -- no React re-renders needed.
//
// Visuals:
//   - Forward arrow (cyan) on root body showing +Z local direction
//   - COM ground projection (yellow sphere)
//   - Support point (green sphere)
//   - COM-to-support error line (red)
//   - Step target (blue sphere, visible during step states)
//   - Step direction arrow (blue, from support to step target)
//   - State label (HTML overlay above the head)
//   - Foot grounded indicators (green/red dots at each foot sole)
//   - COM velocity arrow (orange, scaled)

import { Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { RefObject } from "react";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Line2 } from "three-stdlib";
import type { BalanceDebug } from "@/controllers/BalanceController";
import type { CatchStepDebug } from "@/controllers/CatchStepController";
import type { RapierRig } from "@/physics/RapierRig";
import type { RapierRigIO } from "@/physics/RapierRigIO";

interface RigDebugOverlayProps {
  rig: RapierRig;
  io: RapierRigIO;
  balanceDebugRef: RefObject<BalanceDebug | null>;
  catchStepDebugRef: RefObject<CatchStepDebug | null>;
}

// Reusable temporaries (module-level to avoid per-frame allocation)
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _tip = new THREE.Vector3();

// Arrow parameters
const FWD_ARROW_LEN = 0.35;
const FWD_ARROW_Y_OFFSET = 0.15; // slightly above root center
const MARKER_RADIUS = 0.025;
const VEL_SCALE = 0.3; // meters per m/s

export function RigDebugOverlay({ rig, io, balanceDebugRef, catchStepDebugRef }: RigDebugOverlayProps) {
  // Refs for imperative updates
  const fwdLineRef = useRef<Line2>(null);
  const fwdHeadLRef = useRef<Line2>(null);
  const fwdHeadRRef = useRef<Line2>(null);
  const comMarkerRef = useRef<THREE.Mesh>(null);
  const supportMarkerRef = useRef<THREE.Mesh>(null);
  const errorLineRef = useRef<Line2>(null);
  const stepTargetRef = useRef<THREE.Mesh>(null);
  const stepLineRef = useRef<Line2>(null);
  const velLineRef = useRef<Line2>(null);
  const leanLineRef = useRef<Line2>(null);
  const leanHeadLRef = useRef<Line2>(null);
  const leanHeadRRef = useRef<Line2>(null);
  const leftFootRef = useRef<THREE.Mesh>(null);
  const rightFootRef = useRef<THREE.Mesh>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const labelGroupRef = useRef<THREE.Group>(null);

  // Materials (created once, reused)
  const mats = useMemo(
    () => ({
      cyan: new THREE.MeshBasicMaterial({ color: 0x00cccc, depthTest: false }),
      yellow: new THREE.MeshBasicMaterial({ color: 0xffcc00, depthTest: false }),
      green: new THREE.MeshBasicMaterial({ color: 0x00cc44, depthTest: false }),
      red: new THREE.MeshBasicMaterial({ color: 0xcc2222, depthTest: false }),
      blue: new THREE.MeshBasicMaterial({ color: 0x2266ff, depthTest: false }),
    }),
    []
  );

  // Reusable line geometries: we update positions each frame via drei <Line>
  // For forward arrow, error line, step line, and velocity line, we use
  // drei's <Line> which wraps Line2 and supports lineWidth.
  // We need to use refs and update positions imperatively.

  useFrame(() => {
    // Read refs each frame so we always get the latest controller output
    const bd = balanceDebugRef.current;
    const csd = catchStepDebugRef.current;

    // --- Root forward arrow ---
    const rootRb = rig.world.getRigidBody(rig.getBodyHandle("Root"));
    if (rootRb) {
      const t = rootRb.translation();
      const r = rootRb.rotation();
      _pos.set(t.x, t.y + FWD_ARROW_Y_OFFSET, t.z);
      _quat.set(r.x, r.y, r.z, r.w);

      // Local +Z in world space
      _fwd.set(0, 0, 1).applyQuaternion(_quat).normalize();
      _tip.copy(_pos).addScaledVector(_fwd, FWD_ARROW_LEN);

      // Main shaft
      updateLine(fwdLineRef.current, _pos, _tip);

      // Arrowhead wings (two short lines angled back from the tip)
      const wingLen = 0.08;
      const wingAngle = 0.45; // radians off the shaft
      // Right wing: rotate _fwd by +wingAngle around Y, negate
      const rWing = _fwd
        .clone()
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), wingAngle)
        .negate();
      const rWingTip = _tip.clone().addScaledVector(rWing, wingLen);
      updateLine(fwdHeadRRef.current, _tip, rWingTip);
      // Left wing
      const lWing = _fwd
        .clone()
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), -wingAngle)
        .negate();
      const lWingTip = _tip.clone().addScaledVector(lWing, wingLen);
      updateLine(fwdHeadLRef.current, _tip, lWingTip);

      // Label position: above head
      if (labelGroupRef.current) {
        const headRb = rig.world.getRigidBody(rig.getBodyHandle("Head"));
        if (headRb) {
          const ht = headRb.translation();
          labelGroupRef.current.position.set(ht.x, ht.y + 0.35, ht.z);
        }
      }
    }

    // --- COM projection marker ---
    if (comMarkerRef.current && bd) {
      comMarkerRef.current.position.set(bd.comProj.x, 0.02, bd.comProj.z);
      comMarkerRef.current.visible = true;
    }

    // --- Support point marker ---
    if (supportMarkerRef.current && bd) {
      supportMarkerRef.current.position.set(bd.support.x, 0.02, bd.support.z);
      supportMarkerRef.current.visible = true;
    }

    // --- COM-to-support error line ---
    if (errorLineRef.current && bd) {
      const y = 0.03;
      updateLine(
        errorLineRef.current,
        new THREE.Vector3(bd.support.x, y, bd.support.z),
        new THREE.Vector3(bd.comProj.x, y, bd.comProj.z)
      );
    }

    // --- COM velocity arrow ---
    if (velLineRef.current && bd) {
      const comVel = io.comVelWorld();
      const start = new THREE.Vector3(bd.comProj.x, 0.04, bd.comProj.z);
      const end = new THREE.Vector3(bd.comProj.x + comVel.x * VEL_SCALE, 0.04, bd.comProj.z + comVel.z * VEL_SCALE);
      updateLine(velLineRef.current, start, end);
    }

    // --- Step target marker ---
    if (stepTargetRef.current) {
      if (csd?.stepTarget && csd.state !== "STAND" && csd.state !== "SETTLE") {
        stepTargetRef.current.position.set(csd.stepTarget.x, 0.02, csd.stepTarget.z);
        stepTargetRef.current.visible = true;
      } else {
        stepTargetRef.current.visible = false;
      }
    }

    // --- Step direction line ---
    if (stepLineRef.current) {
      if (csd?.supportPoint && csd.stepTarget && csd.state !== "STAND" && csd.state !== "SETTLE") {
        updateLine(
          stepLineRef.current,
          new THREE.Vector3(csd.supportPoint.x, 0.03, csd.supportPoint.z),
          new THREE.Vector3(csd.stepTarget.x, 0.03, csd.stepTarget.z)
        );
        stepLineRef.current.visible = true;
      } else {
        stepLineRef.current.visible = false;
      }
    }

    // --- Foot grounded indicators ---
    if (leftFootRef.current) {
      const lfc = io.footContact("LeftFoot");
      const lSample = io.sampleBody("LeftFoot");
      leftFootRef.current.position.set(lSample.pos.x, 0.01, lSample.pos.z);
      (leftFootRef.current.material as THREE.MeshBasicMaterial).color.setHex(lfc.grounded ? 0x00cc44 : 0xcc2222);
    }
    if (rightFootRef.current) {
      const rfc = io.footContact("RightFoot");
      const rSample = io.sampleBody("RightFoot");
      rightFootRef.current.position.set(rSample.pos.x, 0.01, rSample.pos.z);
      (rightFootRef.current.material as THREE.MeshBasicMaterial).color.setHex(rfc.grounded ? 0x00cc44 : 0xcc2222);
    }

    // --- Torso lean "ideal up" arrow (magenta) ---
    if (leanLineRef.current && bd) {
      const torsoRb = rig.world.getRigidBody(rig.getBodyHandle("Torso"));
      if (torsoRb) {
        const tt = torsoRb.translation();
        const leanLen = 0.4;
        const start = new THREE.Vector3(tt.x, tt.y, tt.z);
        const leanDir = new THREE.Vector3(bd.torsoLeanDir.x, bd.torsoLeanDir.y, bd.torsoLeanDir.z);
        const end = start.clone().addScaledVector(leanDir, leanLen);
        updateLine(leanLineRef.current, start, end);
        leanLineRef.current.visible = true;

        // Arrowhead wings
        const wingLen = 0.06;
        const wingAngle = 0.5;
        const negDir = leanDir.clone().negate();
        // Pick a perpendicular axis for rotating the wing lines.
        // Use world X unless leanDir is nearly parallel to X, then use Z.
        const perp = Math.abs(leanDir.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
        const rWing = negDir.clone().applyAxisAngle(perp, wingAngle);
        const rWingTip = end.clone().addScaledVector(rWing, wingLen);
        updateLine(leanHeadRRef.current, end, rWingTip);
        const lWing = negDir.clone().applyAxisAngle(perp, -wingAngle);
        const lWingTip = end.clone().addScaledVector(lWing, wingLen);
        updateLine(leanHeadLRef.current, end, lWingTip);
      }
    }

    // --- State label ---
    if (labelRef.current) {
      const state = csd?.state ?? "STAND";
      const fallen = bd?.fallen ?? false;
      const errMag = csd?.errorMagFiltered ?? 0;
      const tiltDeg = bd ? (bd.tiltRad * 180) / Math.PI : 0;

      const urgency = csd?.urgency ?? 0;
      const steps = csd?.consecutiveSteps ?? 0;

      let stateColor = "#ccc";
      if (state === "STEP_SWING") stateColor = "#4af";
      else if (state === "STEP_PREP") stateColor = "#fa4";
      else if (state === "STEP_LAND") stateColor = "#4f4";
      else if (fallen) stateColor = "#f44";

      labelRef.current.innerHTML =
        `<div style="color:${stateColor};font-weight:bold;font-size:13px">${state}</div>` +
        `<div style="font-size:10px;color:#aaa">` +
        `tilt:${tiltDeg.toFixed(0)} err:${errMag.toFixed(3)}` +
        (urgency > 0.01 ? ` urg:${urgency.toFixed(2)}` : "") +
        (steps > 1 ? ` step#${steps}` : "") +
        (fallen ? ' <span style="color:#f44">FALLEN</span>' : "") +
        `</div>`;
    }
  });

  return (
    <>
      {/* Forward arrow (cyan) */}
      <Line
        ref={fwdLineRef}
        points={[
          [0, 0, 0],
          [0, 0, 0.01],
        ]}
        color={0x00cccc}
        lineWidth={3}
        depthTest={false}
        renderOrder={999}
      />
      <Line
        ref={fwdHeadLRef}
        points={[
          [0, 0, 0],
          [0, 0, 0.01],
        ]}
        color={0x00cccc}
        lineWidth={3}
        depthTest={false}
        renderOrder={999}
      />
      <Line
        ref={fwdHeadRRef}
        points={[
          [0, 0, 0],
          [0, 0, 0.01],
        ]}
        color={0x00cccc}
        lineWidth={3}
        depthTest={false}
        renderOrder={999}
      />

      {/* COM-to-support error line (red) */}
      <Line
        ref={errorLineRef}
        points={[
          [0, 0, 0],
          [0, 0, 0.01],
        ]}
        color={0xcc2222}
        lineWidth={2}
        depthTest={false}
        renderOrder={998}
      />

      {/* COM velocity arrow (orange) */}
      <Line
        ref={velLineRef}
        points={[
          [0, 0, 0],
          [0, 0, 0.01],
        ]}
        color={0xff8800}
        lineWidth={2}
        depthTest={false}
        renderOrder={998}
      />

      {/* Torso lean ideal up arrow (magenta) */}
      <Line
        ref={leanLineRef}
        points={[
          [0, 0, 0],
          [0, 0, 0.01],
        ]}
        color={0xff00ff}
        lineWidth={2}
        depthTest={false}
        renderOrder={998}
      />
      <Line
        ref={leanHeadRRef}
        points={[
          [0, 0, 0],
          [0, 0, 0.01],
        ]}
        color={0xff00ff}
        lineWidth={2}
        depthTest={false}
        renderOrder={998}
      />
      <Line
        ref={leanHeadLRef}
        points={[
          [0, 0, 0],
          [0, 0, 0.01],
        ]}
        color={0xff00ff}
        lineWidth={2}
        depthTest={false}
        renderOrder={998}
      />

      {/* Step direction line (blue) */}
      <Line
        ref={stepLineRef}
        points={[
          [0, 0, 0],
          [0, 0, 0.01],
        ]}
        color={0x2266ff}
        lineWidth={2}
        depthTest={false}
        renderOrder={998}
      />

      {/* COM projection marker (yellow) */}
      <mesh ref={comMarkerRef} visible={false} renderOrder={999}>
        <sphereGeometry args={[MARKER_RADIUS, 8, 8]} />
        <meshBasicMaterial color={0xffcc00} depthTest={false} />
      </mesh>

      {/* Support point marker (green) */}
      <mesh ref={supportMarkerRef} visible={false} renderOrder={999}>
        <sphereGeometry args={[MARKER_RADIUS, 8, 8]} />
        <meshBasicMaterial color={0x00cc44} depthTest={false} />
      </mesh>

      {/* Step target marker (blue) */}
      <mesh ref={stepTargetRef} visible={false} renderOrder={999}>
        <sphereGeometry args={[MARKER_RADIUS * 1.5, 8, 8]} />
        <meshBasicMaterial color={0x2266ff} depthTest={false} />
      </mesh>

      {/* Foot grounded indicators */}
      <mesh ref={leftFootRef} renderOrder={999}>
        <sphereGeometry args={[MARKER_RADIUS * 0.8, 6, 6]} />
        <meshBasicMaterial color={0x00cc44} depthTest={false} />
      </mesh>
      <mesh ref={rightFootRef} renderOrder={999}>
        <sphereGeometry args={[MARKER_RADIUS * 0.8, 6, 6]} />
        <meshBasicMaterial color={0x00cc44} depthTest={false} />
      </mesh>

      {/* State label (HTML overlay, constant screen size) */}
      <group ref={labelGroupRef}>
        <Html center style={{ pointerEvents: "none" }}>
          <div
            ref={labelRef}
            style={{
              textAlign: "center",
              fontFamily: "monospace",
              fontSize: "13px",
              userSelect: "none",
              textShadow: "0 0 4px #000, 0 0 2px #000",
              whiteSpace: "nowrap",
            }}
          />
        </Html>
      </group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Helper: update a Line2's geometry in-place
// ---------------------------------------------------------------------------

function updateLine(line: Line2 | null, start: THREE.Vector3, end: THREE.Vector3): void {
  if (!line) return;
  const geom = line.geometry as unknown as { setPositions?: (arr: number[]) => void };
  geom.setPositions?.([start.x, start.y, start.z, end.x, end.y, end.z]);
}
