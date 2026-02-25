// src/components/CharacterRig.tsx

import { useBeforePhysicsStep, useRapier } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import { q, v3 } from "@/lib/math";
import { RapierRig } from "@/physics/RapierRig";
import { RapierRigIO } from "@/physics/RapierRigIO";
import { RigDefinitionV0 } from "@/rig/RigDefinition.v0";

export function CharacterRig(props: { spawn?: { x: number; y: number; z: number } }) {
  const { rapier, world } = useRapier();
  const { spawn } = props;

  const rigRef = useRef<RapierRig | null>(null);
  const ioRef = useRef<RapierRigIO | null>(null);

  useEffect(() => {
    if (!world) return;

    const sp = spawn ?? { x: 0, y: 1.5, z: 0 };
    const rig = new RapierRig(rapier, world, RigDefinitionV0, {
      rootWorldPos: v3(sp.x, sp.y, sp.z),
      rootWorldRot: q(0, 0, 0, 1),
    });

    const io = new RapierRigIO(rapier, world, rig);

    rigRef.current = rig;
    ioRef.current = io;

    return () => {
      ioRef.current = null;
      rigRef.current?.dispose();
      rigRef.current = null;
    };
  }, [rapier, world, spawn]);

  useBeforePhysicsStep((stepWorld) => {
    const io = ioRef.current;
    if (!io) return;

    // Use the fixed timestep from Rapier (typically 1/60)
    const dt = stepWorld.timestep;
    io.setDt(dt);

    // Test: keep torso aligned to root (identity joint target)
    io.driveJoint("Root_Torso", {
      targetLocalRot: q(0, 0, 0, 1),
      kp: 120,
      kd: 20,
      maxTorque: 320,
    });
  });

  // Rendering strategy:
  // - simplest: render nothing for now, and just confirm physics works via debug lines
  // - next: render primitive meshes that read rig body transforms each frame

  return null;
}
