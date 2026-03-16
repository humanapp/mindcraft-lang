import { Color, type ColorRepresentation, ShaderMaterial } from "three";

const MAX_STOPS = 8;

const vertexShader = /* glsl */ `
varying vec3 vWorldDirection;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldDirection = normalize(worldPos.xyz - cameraPosition);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColors[${MAX_STOPS}];
uniform float uPositions[${MAX_STOPS}];
uniform int uStopCount;
uniform float uExponent;
uniform float uOffset;

varying vec3 vWorldDirection;

void main() {
  float h = normalize(vWorldDirection).y * 0.5 + 0.5;
  h = clamp(h + uOffset, 0.0, 1.0);
  h = pow(h, uExponent);

  vec3 col = uColors[0];
  for (int i = 1; i < ${MAX_STOPS}; i++) {
    if (i >= uStopCount) break;
    float t = clamp(
      (h - uPositions[i - 1]) / (uPositions[i] - uPositions[i - 1]),
      0.0,
      1.0
    );
    col = mix(col, uColors[i], t);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export type PreparedStops = {
  colors: Color[];
  positions: number[];
  count: number;
};

export function createGradientSkyboxMaterial(stops: PreparedStops, exponent: number, offset: number): ShaderMaterial {
  const colors = new Array<Color>(MAX_STOPS);
  const positions = new Array<number>(MAX_STOPS);

  for (let i = 0; i < MAX_STOPS; i++) {
    colors[i] = i < stops.count ? stops.colors[i] : new Color(0, 0, 0);
    positions[i] = i < stops.count ? stops.positions[i] : 1.0;
  }

  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uColors: { value: colors },
      uPositions: { value: positions },
      uStopCount: { value: stops.count },
      uExponent: { value: exponent },
      uOffset: { value: offset },
    },
    depthWrite: false,
    side: 1, // BackSide
  });
}

export function updateGradientSkyboxUniforms(
  material: ShaderMaterial,
  stops: PreparedStops,
  exponent: number,
  offset: number
): void {
  const colors: Color[] = material.uniforms.uColors.value;
  const positions: number[] = material.uniforms.uPositions.value;

  for (let i = 0; i < MAX_STOPS; i++) {
    if (i < stops.count) {
      colors[i].copy(stops.colors[i]);
      positions[i] = stops.positions[i];
    } else {
      colors[i].setRGB(0, 0, 0);
      positions[i] = 1.0;
    }
  }

  material.uniforms.uStopCount.value = stops.count;
  material.uniforms.uExponent.value = exponent;
  material.uniforms.uOffset.value = offset;
}

export { MAX_STOPS };
