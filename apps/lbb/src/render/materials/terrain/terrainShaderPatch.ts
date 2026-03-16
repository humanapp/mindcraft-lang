import type { WebGLProgramParametersWithUniforms } from "three";
import { glslHeightMask, glslSlopeMask } from "../shared/shaderMasks";
import { glslNoise3D } from "../shared/shaderNoise";
import type { TerrainUniformMap } from "./terrainUniforms";

const vertexPreamble = /* glsl */ `
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
`;

const vertexMain = /* glsl */ `
vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWorldNormal = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
`;

const fragmentPreamble = /* glsl */ `
uniform vec3 lowColor;
uniform vec3 highColor;
uniform vec3 steepColor;
uniform float heightMin;
uniform float heightMax;
uniform float noiseScale;
uniform float noiseStrength;
uniform float roughnessBase;
uniform float roughnessVariation;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

${glslNoise3D}
${glslSlopeMask}
${glslHeightMask}
`;

const fragmentColorReplace = /* glsl */ `
{
  // -- height gradient --
  float ht = heightMask(vWorldPosition.y, heightMin, heightMax);
  vec3 terrainColor = mix(lowColor, highColor, ht);

  // -- slope tint --
  float slope = slopeMask(vWorldNormal);
  terrainColor = mix(terrainColor, steepColor, slope * 0.6);

  // -- world-space noise breakup --
  float n = snoise3(vWorldPosition * noiseScale);
  terrainColor *= 1.0 + n * noiseStrength;

  // -- apply to diffuse --
  diffuseColor.rgb = terrainColor;
}
`;

const fragmentRoughnessReplace = /* glsl */ `
#include <roughnessmap_fragment>
{
  float slope = slopeMask(vWorldNormal);
  float n = snoise3(vWorldPosition * noiseScale);
  roughnessFactor = roughnessBase + n * roughnessVariation;
  roughnessFactor += slope * 0.05;
  roughnessFactor = clamp(roughnessFactor, 0.0, 1.0);
}
`;

export function applyTerrainShaderPatch(shader: WebGLProgramParametersWithUniforms, uniforms: TerrainUniformMap): void {
  for (const [key, entry] of Object.entries(uniforms)) {
    shader.uniforms[key] = entry;
  }

  shader.vertexShader = shader.vertexShader.replace("void main() {", `${vertexPreamble}\nvoid main() {`);

  shader.vertexShader = shader.vertexShader.replace(
    "#include <begin_vertex>",
    `#include <begin_vertex>\n${vertexMain}`
  );

  shader.fragmentShader = shader.fragmentShader.replace("void main() {", `${fragmentPreamble}\nvoid main() {`);

  shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", fragmentColorReplace);

  shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", fragmentRoughnessReplace);
}
