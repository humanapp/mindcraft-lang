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
uniform sampler2D uDepthTexture;
uniform float uCameraNear;
uniform float uCameraFar;
uniform vec2 uResolution;
uniform vec3 uFoamColor;
uniform float uFoamStrength;
uniform float uShoreMaxDist;

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

float linearizeDepth(float d) {
  return uCameraNear * uCameraFar / (uCameraFar - d * (uCameraFar - uCameraNear));
}

const mat2 ROT = mat2(0.80, -0.60, 0.60, 0.80);

float fbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * valueNoise(p);
    p = ROT * p * 2.05 + 17.0;
    a *= 0.45;
  }
  return v;
}

float warpedNoise(vec2 p, float t) {
  vec2 q = vec2(
    fbm3(p + vec2(t * 0.07, t * 0.05)),
    fbm3(p + vec2(t * 0.05, -t * 0.06) + 40.0)
  );
  return fbm3(p + q * 2.2);
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

  // -- Shoreline intersection (depth-based) --
  vec2 screenUV = gl_FragCoord.xy / uResolution;
  float rawSceneDepth = texture2D(uDepthTexture, screenUV).r;
  float linearScene = linearizeDepth(rawSceneDepth);
  float linearWater = linearizeDepth(gl_FragCoord.z);
  float thickness = linearScene - linearWater;
  float validMask = step(0.0, thickness);

  // Normalized thickness ratio for band derivation
  float tNorm = clamp(thickness / uShoreMaxDist, 0.0, 1.0);

  // -- Directional wave bias --
  vec2 waveDir = normalize(vec2(0.7, 0.45));
  float dirProj = dot(wpos, waveDir);
  float dirWave = sin(dirProj * 0.18 + uTime * 0.9) * 0.5 + 0.5;
  float dirBias = 0.8 + 0.2 * dirWave;

  // -- Three shoreline bands from thickness --
  // Inner: tight contact foam (thickness 0..30% of max)
  float bandInner = smoothstep(0.3, 0.0, tNorm) * validMask;
  // Mid: broken churn region (thickness 10..65% of max)
  float bandMid = smoothstep(0.1, 0.25, tNorm) * smoothstep(0.65, 0.35, tNorm) * validMask;
  // Outer: subtle disturbance (thickness 40..100% of max)
  float bandOuter = smoothstep(0.4, 0.55, tNorm) * smoothstep(1.0, 0.7, tNorm) * validMask;

  // -- Noise layers (domain-warped, rotated FBM) --
  vec2 shoreP = ROT * wpos;
  float noiseFine = warpedNoise(shoreP * 0.28, uTime * 1.2);
  float noiseMed = warpedNoise(shoreP * 0.12 + 77.0, uTime * 0.8);
  float noiseCoarse = warpedNoise(shoreP * 0.05 + 150.0, uTime * 0.5);

  // Wave-phase temporal modulation
  float wavePhase = sin(dirProj * 0.14 + uTime * 1.1);
  float waveMod = 0.7 + 0.3 * wavePhase;

  // -- Inner foam: bright, sharp, tight --
  float innerFoam = bandInner * smoothstep(0.35, 0.65, noiseFine) * dirBias * waveMod;

  // -- Mid churn: softer, wider, more broken --
  float midFoam = bandMid * smoothstep(0.4, 0.7, noiseMed * 0.55 + noiseCoarse * 0.45);
  midFoam *= 0.65 * dirBias;

  // -- Outer disturbance: very subtle --
  float outerFoam = bandOuter * smoothstep(0.45, 0.7, noiseCoarse) * 0.3;

  // Combine foam bands with spatial intensity variation
  float intensityVar = 0.7 + 0.3 * noiseCoarse;
  float totalFoam = (innerFoam * 0.85 + midFoam * 0.5 + outerFoam * 0.2) * intensityVar;
  totalFoam = min(totalFoam, 0.75);

  color = mix(color, uFoamColor, totalFoam * uFoamStrength);

  // -- Turbidity: clouded shallow water, separate from foam --
  float turbidZone = smoothstep(0.5, 0.0, tNorm) * validMask;
  float turbidNoise = warpedNoise(shoreP * 0.06 + 300.0, uTime * 0.35);
  float turbidity = turbidZone * (0.6 + 0.4 * turbidNoise) * 0.3;
  vec3 turbidColor = mix(uShallowColor, uFoamColor, 0.35);
  color = mix(color, turbidColor, turbidity);

  // -- Contact haze: very soft blend at the immediate boundary --
  float haze = (bandInner * 0.6 + bandMid * 0.3) * 0.15;
  color = mix(color, uFoamColor * 0.9 + color * 0.1, haze);

  // -- Outer softness veil: broad, low-contrast transition beyond foam --
  // Extends to 2.5x the foam range for a wide soft falloff
  float veilWidth = uShoreMaxDist * 2.5;
  float veilRaw = clamp(1.0 - thickness / veilWidth, 0.0, 1.0) * validMask;
  // Shape: fade in beyond the foam/churn region, peak around 60-90% of foam range
  float veilMask = veilRaw * veilRaw * smoothstep(0.0, 0.25, tNorm);
  // Low-frequency noise for irregular edge (no sparkle)
  float veilNoise = warpedNoise(shoreP * 0.03 + 420.0, uTime * 0.25);
  veilMask *= 0.65 + 0.35 * veilNoise;
  // Blend toward a color only slightly milkier than the surrounding water
  vec3 veilTone = mix(color, turbidColor, 0.4);
  color = mix(color, veilTone, veilMask * 0.18);

  // -- Wet/dark band: subtle darkening just outside the foam edge --
  float wetBand = smoothstep(0.6, 0.85, tNorm) * smoothstep(1.3, 0.95, thickness / uShoreMaxDist) * validMask;
  wetBand *= 0.6 + 0.4 * veilNoise;
  color *= 1.0 - wetBand * 0.06;

  // -- Fog / horizon blend --
  float fogFactor = smoothstep(uFogNear, uFogFar, dist);
  color = mix(color, uFogColor, fogFactor);

  // Alpha: fade to transparent beyond fog range so geometry edge is never visible
  float alpha = mix(uOpacity, 1.0, fresnel * 0.4);
  float edgeFade = 1.0 - smoothstep(uFogFar * 0.8, uFogFar * 1.5, dist);
  alpha *= edgeFade;

  gl_FragColor = vec4(color, alpha);
}
