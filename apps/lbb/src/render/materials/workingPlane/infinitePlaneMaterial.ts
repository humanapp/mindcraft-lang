import { Color, DoubleSide, ShaderMaterial, Vector3 } from "three";
import fragmentShader from "./workingPlane.frag";
import vertexShader from "./workingPlane.vert";

export interface InfinitePlaneMaterialOptions {
  depthTest: boolean;
  opacityScale: number;
}

export function createInfinitePlaneMaterial(options: InfinitePlaneMaterialOptions): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uCursorPos: { value: new Vector3() },
      uFalloffRadius: { value: 60.0 },
      uOpacityScale: { value: options.opacityScale },
      uColor: { value: new Color(0xffffff) },
      uMinorSpacing: { value: 2.0 },
      uMajorMultiplier: { value: 5.0 },
    },
    transparent: true,
    depthTest: options.depthTest,
    depthWrite: false,
    side: DoubleSide,
  });
}
