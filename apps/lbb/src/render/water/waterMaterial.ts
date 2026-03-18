import type { DepthTexture } from "three";
import { Color, DoubleSide, ShaderMaterial, Vector2, Vector3 } from "three";
import fragmentShader from "./water.frag";
import vertexShader from "./water.vert";

const SUN_DIR = new Vector3(160, 180, 120).normalize();

const ISLAND_CENTER_X = 128;
const ISLAND_CENTER_Z = 128;
const ISLAND_RADIUS = 75;

export function createWaterMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uShallowColor: { value: new Color("#4a9a8a") },
      uMidColor: { value: new Color("#2a6a7a") },
      uDeepColor: { value: new Color("#152e4a") },
      uFogColor: { value: new Color("#888888") },
      uFogNear: { value: 150 },
      uFogFar: { value: 350 },
      uOpacity: { value: 0.88 },
      uSunDirection: { value: SUN_DIR.clone() },
      uIslandCenter: { value: new Vector2(ISLAND_CENTER_X, ISLAND_CENTER_Z) },
      uIslandRadius: { value: ISLAND_RADIUS },
      uDepthTexture: { value: null as DepthTexture | null },
      uCameraNear: { value: 0.5 },
      uCameraFar: { value: 1500 },
      uResolution: { value: new Vector2(1, 1) },
      uFoamColor: { value: new Color(0.83, 0.89, 0.86) },
      uFoamStrength: { value: 0.55 },
      uShoreMaxDist: { value: 3.0 },
    },
    transparent: true,
    depthWrite: true,
    side: DoubleSide,
  });
}
