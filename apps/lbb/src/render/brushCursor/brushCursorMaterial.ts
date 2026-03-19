import { Color, DoubleSide, Matrix4, ShaderMaterial, Vector2, Vector3 } from "three";
import fragmentShader from "./brushCursor.frag";
import vertexShader from "./brushCursor.vert";

export function createBrushCursorMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uDepthTexture: { value: null },
      uCameraNear: { value: 0.5 },
      uCameraFar: { value: 1500 },
      uResolution: { value: new Vector2(1, 1) },
      uBorderColorCore: { value: new Color("#ffe566") },
      uBorderColorOuter: { value: new Color("#ffc830") },
      uShellColor: { value: new Color("#b0d4ef") },
      uBorderWidth: { value: 3.5 },
      uShellOpacity: { value: 1.0 },
      uBorderOpacity: { value: 0.9 },
      uInvProjectionView: { value: new Matrix4() },
      uBrushCenter: { value: new Vector3() },
      uBrushRadius: { value: 4.0 },
      uBrushShape: { value: 0.0 },
      uActive: { value: 0.0 },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  });
}
