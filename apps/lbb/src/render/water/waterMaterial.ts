import { Color, DoubleSide, ShaderMaterial, Vector2, Vector3 } from "three";

const vertexShader = /* glsl */ `
uniform float uTime;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vDistToCamera;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);

  float wx = worldPos.x;
  float wz = worldPos.z;
  float dist = length(worldPos.xz - cameraPosition.xz);

  // Distance-based detail fade: swell always visible, detail fades out
  float detailFade = 1.0 - smoothstep(60.0, 280.0, dist);
  float fineFade = detailFade * detailFade;

  // -- Tier 1: large-scale ocean swell (always visible) --
  float swell = 0.0;
  swell += sin(wx * 0.008 + wz * 0.005 + uTime * 0.4) * 0.18;
  swell += sin(wx * 0.004 - wz * 0.011 + uTime * 0.3) * 0.11;

  // -- Tier 2: medium waves (fade with distance) --
  float waves = 0.0;
  waves += sin(wx * 0.022 + uTime * 0.7) * 0.10;
  waves += sin(wz * 0.028 + uTime * 0.55) * 0.08;
  waves += sin((wx + wz) * 0.016 + uTime * 0.85) * 0.05;

  // -- Tier 3: fine ripples (fade faster) --
  float ripples = 0.0;
  ripples += sin(wx * 0.06 + wz * 0.045 + uTime * 1.4) * 0.025;
  ripples += sin(wx * 0.05 - wz * 0.055 + uTime * 1.1) * 0.018;

  worldPos.y += swell + waves * detailFade + ripples * fineFade;

  // Analytical normal from partial derivatives
  float ddx = 0.0;
  float ddz = 0.0;

  // Swell derivatives (always present)
  float p1 = wx * 0.008 + wz * 0.005 + uTime * 0.4;
  ddx += cos(p1) * 0.18 * 0.008;
  ddz += cos(p1) * 0.18 * 0.005;
  float p2 = wx * 0.004 - wz * 0.011 + uTime * 0.3;
  ddx += cos(p2) * 0.11 * 0.004;
  ddz += cos(p2) * 0.11 * (-0.011);

  // Medium wave derivatives (faded)
  ddx += cos(wx * 0.022 + uTime * 0.7) * 0.10 * 0.022 * detailFade;
  ddz += cos(wz * 0.028 + uTime * 0.55) * 0.08 * 0.028 * detailFade;
  float p3 = (wx + wz) * 0.016 + uTime * 0.85;
  ddx += cos(p3) * 0.05 * 0.016 * detailFade;
  ddz += cos(p3) * 0.05 * 0.016 * detailFade;

  // Fine ripple derivatives (faded faster)
  float p4 = wx * 0.06 + wz * 0.045 + uTime * 1.4;
  ddx += cos(p4) * 0.025 * 0.06 * fineFade;
  ddz += cos(p4) * 0.025 * 0.045 * fineFade;

  vNormal = normalize(vec3(-ddx, 1.0, -ddz));
  vWorldPosition = worldPos.xyz;
  vDistToCamera = dist;

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
uniform vec3 uMidColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uOpacity;
uniform vec3 uSunDirection;
uniform float uTime;
uniform vec2 uIslandCenter;
uniform float uIslandRadius;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vDistToCamera;

// Compact hash for procedural noise
float hash(vec2 p) {
  float h = dot(p, vec2(127.1, 311.7));
  return fract(sin(h) * 43758.5453);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float dist = vDistToCamera;

  // Detail fade for fragment-level effects
  float detailFade = 1.0 - smoothstep(40.0, 250.0, dist);

  // -- Animated normal perturbation (3 scrolling noise layers) --
  vec3 normal = vNormal;

  vec2 wpos = vWorldPosition.xz;

  // Layer 1: large slow ripples
  float n1x = valueNoise(wpos * 0.05 + vec2(uTime * 0.2, uTime * 0.15));
  float n1z = valueNoise(wpos * 0.05 + vec2(uTime * 0.15, -uTime * 0.2) + 50.0);
  // Layer 2: medium ripples, different direction
  float n2x = valueNoise(wpos * 0.12 + vec2(-uTime * 0.35, uTime * 0.25));
  float n2z = valueNoise(wpos * 0.12 + vec2(uTime * 0.25, uTime * 0.4) + 100.0);
  // Layer 3: fine sparkle
  float n3x = valueNoise(wpos * 0.3 + vec2(uTime * 0.6, -uTime * 0.45));
  float n3z = valueNoise(wpos * 0.3 + vec2(-uTime * 0.5, uTime * 0.65) + 200.0);

  float strength = detailFade;
  normal.x += ((n1x - 0.5) * 0.06 + (n2x - 0.5) * 0.035 + (n3x - 0.5) * 0.015 * detailFade) * strength;
  normal.z += ((n1z - 0.5) * 0.06 + (n2z - 0.5) * 0.035 + (n3z - 0.5) * 0.015 * detailFade) * strength;
  normal = normalize(normal);

  // -- Fresnel --
  float cosTheta = max(dot(viewDir, normal), 0.0);
  float fresnel = pow(1.0 - cosTheta, 5.0);
  fresnel = fresnel * 0.35;

  // -- Depth-based coloration --
  float islandDist = length(vWorldPosition.xz - uIslandCenter);
  float depthFactor = smoothstep(uIslandRadius * 0.5, uIslandRadius * 1.5, islandDist);

  // Shallow near island -> mid-tone -> deep far away
  vec3 baseColor = mix(uShallowColor, uMidColor, smoothstep(0.0, 0.4, depthFactor));
  baseColor = mix(baseColor, uDeepColor, smoothstep(0.3, 1.0, depthFactor));

  // Fresnel shifts toward sky/reflection at grazing angles
  vec3 horizonColor = mix(uDeepColor, uFogColor, 0.3);
  vec3 color = mix(baseColor, horizonColor, fresnel);

  // -- Specular highlights --
  vec3 reflDir = reflect(-uSunDirection, normal);
  float NdotR = max(dot(viewDir, reflDir), 0.0);

  // Broad soft sheen
  float specBroad = pow(NdotR, 12.0);
  color += vec3(0.85, 0.88, 0.9) * specBroad * 0.12;

  // Moderate glint -- visible but restrained
  float specGlint = pow(NdotR, 48.0);
  color += vec3(0.95, 0.94, 0.9) * specGlint * 0.18;

  // Clamp additive highlight so it never blows out
  color = min(color, vec3(1.1));

  // -- Fog / horizon blend --
  float fogFactor = smoothstep(uFogNear, uFogFar, dist);
  color = mix(color, uFogColor, fogFactor);

  // Alpha: fade to transparent beyond fog range so geometry edge is never visible
  float alpha = mix(uOpacity, 1.0, fresnel * 0.4);
  float edgeFade = 1.0 - smoothstep(uFogFar * 0.8, uFogFar * 1.5, dist);
  alpha *= edgeFade;

  gl_FragColor = vec4(color, alpha);
}
`;

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
    },
    transparent: true,
    depthWrite: true,
    side: DoubleSide,
  });
}
