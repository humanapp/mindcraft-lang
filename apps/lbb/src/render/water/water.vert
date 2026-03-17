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
