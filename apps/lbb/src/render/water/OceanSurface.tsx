import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { Mesh, PerspectiveCamera } from "three";
import {
  DepthTexture,
  Fog,
  MeshBasicMaterial,
  PlaneGeometry,
  UnsignedIntType,
  Vector3,
  WebGLRenderTarget,
} from "three";
import { useEditorStore } from "@/editor/editor-store";
import { LAYER_WORLD } from "@/render/layers";
import { createWaterMaterial } from "./waterMaterial";

const PLANE_SIZE = 2000;
const PLANE_SEGMENTS = 128;

const BASE_SUN_DIR = new Vector3(160, 180, 120).normalize();
const _rotatedSun = new Vector3();

interface OceanSurfaceProps {
  seaLevel: number;
}

export function OceanSurface({ seaLevel }: OceanSurfaceProps) {
  const meshRef = useRef<Mesh>(null);

  const geometry = useMemo(() => new PlaneGeometry(PLANE_SIZE, PLANE_SIZE, PLANE_SEGMENTS, PLANE_SEGMENTS), []);

  const material = useMemo(() => createWaterMaterial(), []);

  const depthTarget = useMemo(() => {
    const dt = new DepthTexture(1, 1);
    dt.type = UnsignedIntType;
    const rt = new WebGLRenderTarget(1, 1, { depthTexture: dt });
    return rt;
  }, []);

  const depthPassMaterial = useMemo(() => {
    const mat = new MeshBasicMaterial();
    mat.colorWrite = false;
    return mat;
  }, []);

  const mainCamera = useThree((s) => s.camera);
  const depthCamera = useMemo(() => {
    const cam = mainCamera.clone();
    cam.layers.disableAll();
    cam.layers.enable(LAYER_WORLD);
    return cam;
  }, [mainCamera]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
      depthTarget.dispose();
      depthPassMaterial.dispose();
    };
  }, [geometry, material, depthTarget, depthPassMaterial]);

  useFrame(({ camera, clock, scene, gl, size }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    mesh.position.x = camera.position.x;
    mesh.position.y = seaLevel;
    mesh.position.z = camera.position.z;

    material.uniforms.uTime.value = clock.elapsedTime;

    const angle = useEditorStore.getState().waterSunAngle * (Math.PI / 180);
    _rotatedSun
      .set(
        BASE_SUN_DIR.x * Math.cos(angle) - BASE_SUN_DIR.z * Math.sin(angle),
        BASE_SUN_DIR.y,
        BASE_SUN_DIR.x * Math.sin(angle) + BASE_SUN_DIR.z * Math.cos(angle)
      )
      .normalize();
    material.uniforms.uSunDirection.value.copy(_rotatedSun);

    if (scene.fog instanceof Fog) {
      material.uniforms.uFogColor.value.copy(scene.fog.color);
      material.uniforms.uFogNear.value = scene.fog.near;
      material.uniforms.uFogFar.value = scene.fog.far;
    }

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
  });

  return (
    <mesh ref={meshRef} geometry={geometry} material={material} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false} />
  );
}
