import type { WebGLProgramParametersWithUniforms } from "three";
import fragmentColorReplace from "./terrainFragColor.glsl";
import fragmentPreamble from "./terrainFragPreamble.glsl";
import fragmentRoughnessReplace from "./terrainFragRoughness.glsl";
import type { TerrainUniformMap } from "./terrainUniforms";
import vertexMain from "./terrainVertMain.glsl";
import vertexPreamble from "./terrainVertPreamble.glsl";

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
