import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { Mesh, PerspectiveCamera } from "three";
import { Color, DepthTexture, Matrix4, MeshBasicMaterial, UnsignedIntType, WebGLRenderTarget } from "three";
import { useEditorStore } from "@/editor/editor-store";
import { LAYER_EDITOR, LAYER_WORLD } from "@/render/layers";
import { useSessionStore } from "@/session/session-store";
import type { BrushShape } from "@/world/terrain/edit";
import { createBrushCursorMaterial } from "./brushCursorMaterial";

interface BrushCursorProps {
  radius: number;
  shape: BrushShape;
}

function BrushGeometry({ radius, shape }: { radius: number; shape: BrushShape }) {
  switch (shape) {
    case "sphere":
      return <icosahedronGeometry args={[radius, 4]} />;
    case "cube":
      return <boxGeometry args={[radius * 2, radius * 2, radius * 2]} />;
    case "capsule":
      return <capsuleGeometry args={[radius, radius, 8, 16]} />;
  }
}

const SHAPE_INDEX: Record<BrushShape, number> = {
  sphere: 0,
  cube: 1,
  capsule: 2,
};

const _invProjView = new Matrix4();
const _idleCore = new Color("#ffe566");
const _idleOuter = new Color("#ffc830");
const _activeCore = new Color("#ffb855");
const _activeOuter = new Color("#ffc830");

export function BrushCursor({ radius, shape }: BrushCursorProps) {
  const meshRef = useRef<Mesh>(null);

  const material = useMemo(() => createBrushCursorMaterial(), []);

  const depthTarget = useMemo(() => {
    const dt = new DepthTexture(1, 1);
    dt.type = UnsignedIntType;
    return new WebGLRenderTarget(1, 1, { depthTexture: dt });
  }, []);

  const depthPassMaterial = useMemo(() => {
    const mat = new MeshBasicMaterial();
    mat.colorWrite = false;
    return mat;
  }, []);

  const mainCamera = useThree((s) => s.camera);
  const depthCamera = useMemo(() => {
    const cam = (mainCamera as PerspectiveCamera).clone();
    cam.layers.disableAll();
    cam.layers.enable(LAYER_WORLD);
    return cam;
  }, [mainCamera]);

  useEffect(() => {
    return () => {
      material.dispose();
      depthTarget.dispose();
      depthPassMaterial.dispose();
    };
  }, [material, depthTarget, depthPassMaterial]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.layers.disableAll();
    mesh.layers.enable(LAYER_EDITOR);
  });

  useFrame(({ camera, scene, gl, size }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const pos = useSessionStore.getState().hoverWorldPos;
    const hidden = useEditorStore.getState().spaceHeld;

    if (!pos || hidden) {
      mesh.visible = false;
      return;
    }

    mesh.position.set(pos[0], pos[1], pos[2]);

    const dpr = gl.getPixelRatio();
    const pw = Math.ceil(size.width * dpr);
    const ph = Math.ceil(size.height * dpr);
    if (depthTarget.width !== pw || depthTarget.height !== ph) {
      depthTarget.setSize(pw, ph);
    }

    depthCamera.position.copy(camera.position);
    depthCamera.quaternion.copy(camera.quaternion);
    (depthCamera as PerspectiveCamera).projectionMatrix.copy((camera as PerspectiveCamera).projectionMatrix);

    mesh.visible = false;
    scene.overrideMaterial = depthPassMaterial;
    gl.setRenderTarget(depthTarget);
    gl.render(scene, depthCamera);
    gl.setRenderTarget(null);
    scene.overrideMaterial = null;
    mesh.visible = true;

    const perspCam = camera as PerspectiveCamera;
    material.uniforms.uDepthTexture.value = depthTarget.depthTexture;
    material.uniforms.uCameraNear.value = perspCam.near;
    material.uniforms.uCameraFar.value = perspCam.far;
    material.uniforms.uResolution.value.set(pw, ph);

    _invProjView.multiplyMatrices(perspCam.projectionMatrix, perspCam.matrixWorldInverse).invert();
    material.uniforms.uInvProjectionView.value.copy(_invProjView);
    material.uniforms.uBrushCenter.value.set(pos[0], pos[1], pos[2]);
    material.uniforms.uBrushRadius.value = radius;
    material.uniforms.uBrushShape.value = SHAPE_INDEX[shape];

    const active = useSessionStore.getState().isPointerDown ? 1.0 : 0.0;
    const prev = material.uniforms.uActive.value as number;
    const speed = active > prev ? 12.0 : 4.0;
    material.uniforms.uActive.value = prev + (active - prev) * Math.min(1.0, speed / 60);

    const a = material.uniforms.uActive.value as number;
    (material.uniforms.uBorderColorCore.value as Color).copy(_idleCore).lerp(_activeCore, a);
    (material.uniforms.uBorderColorOuter.value as Color).copy(_idleOuter).lerp(_activeOuter, a);
  });

  return (
    <mesh ref={meshRef} material={material} frustumCulled={false} visible={false}>
      <BrushGeometry radius={radius} shape={shape} />
    </mesh>
  );
}
