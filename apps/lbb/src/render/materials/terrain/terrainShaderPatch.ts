import type { WebGLProgramParametersWithUniforms } from "three";
import heightMaskGlsl from "../shared/heightMask.glsl?raw";
import noiseGlsl from "../shared/noise.glsl?raw";
import slopeMaskGlsl from "../shared/slopeMask.glsl?raw";
import fragmentColorReplace from "./terrainFragColor.glsl?raw";
import fragmentPreambleGlsl from "./terrainFragPreamble.glsl?raw";
import fragmentRoughnessReplace from "./terrainFragRoughness.glsl?raw";
import type { TerrainUniformMap } from "./terrainUniforms";
import vertexMain from "./terrainVertMain.glsl?raw";
import vertexPreamble from "./terrainVertPreamble.glsl?raw";

const fragmentPreamble = `${fragmentPreambleGlsl}\n${noiseGlsl}\n${slopeMaskGlsl}\n${heightMaskGlsl}`;

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
