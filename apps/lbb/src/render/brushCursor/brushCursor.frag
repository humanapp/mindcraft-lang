uniform sampler2D uDepthTexture;
uniform float uCameraNear;
uniform float uCameraFar;
uniform vec2 uResolution;
uniform vec3 uBorderColorCore;
uniform vec3 uBorderColorOuter;
uniform vec3 uShellColor;
uniform float uBorderWidth;
uniform float uShellOpacity;
uniform float uBorderOpacity;
uniform mat4 uInvProjectionView;
uniform vec3 uBrushCenter;
uniform float uBrushRadius;
uniform float uBrushShape;
uniform float uActive;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

float linearizeDepth(float d) {
  return uCameraNear * uCameraFar / (uCameraFar - d * (uCameraFar - uCameraNear));
}

float brushSDF(vec3 p) {
  vec3 d = p - uBrushCenter;
  if (uBrushShape < 0.5) {
    return length(d) - uBrushRadius;
  } else if (uBrushShape < 1.5) {
    vec3 q = abs(d) - vec3(uBrushRadius);
    return max(q.x, max(q.y, q.z));
  } else {
    float halfBody = uBrushRadius * 0.5;
    float clampedY = clamp(d.y, -halfBody, halfBody);
    return length(vec3(d.x, d.y - clampedY, d.z)) - uBrushRadius;
  }
}

void main() {
  vec2 screenUV = gl_FragCoord.xy / uResolution;

  // Fresnel -- flip normal for back faces
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  vec3 normal = normalize(vWorldNormal);
  if (!gl_FrontFacing) normal = -normal;
  float NdotV = abs(dot(viewDir, normal));
  float fresnel = pow(1.0 - NdotV, 3.0);

  // Terrain depth
  float terrainRawDepth = texture2D(uDepthTexture, screenUV).x;
  float terrainLinear = linearizeDepth(terrainRawDepth);
  float fragLinear = linearizeDepth(gl_FragCoord.z);
  float depthDiff = terrainLinear - fragLinear;
  float hasTerrain = step(terrainRawDepth, 0.9999);

  // === TERRAIN INTERSECTION BAND ===
  // Reconstruct terrain world position from the depth buffer
  vec2 ndc = screenUV * 2.0 - 1.0;
  float clipZ = terrainRawDepth * 2.0 - 1.0;
  vec4 clipPos = vec4(ndc, clipZ, 1.0);
  vec4 terrainWorld4 = uInvProjectionView * clipPos;
  vec3 terrainWorldPos = terrainWorld4.xyz / terrainWorld4.w;

  // Evaluate brush SDF at the terrain surface position
  float sdf = brushSDF(terrainWorldPos);
  float bandHalfWidth = max(uBrushRadius * 0.06, 0.25);
  float sdDist = abs(sdf);

  float bandCore = 1.0 - smoothstep(0.0, bandHalfWidth * 0.2, sdDist);
  float bandInner = (1.0 - smoothstep(0.0, bandHalfWidth * 0.5, sdDist)) * 0.65;
  float bandOuter = (1.0 - smoothstep(0.0, bandHalfWidth, sdDist)) * 0.3;
  float bandIntensity = min(bandCore + bandInner + bandOuter, 1.0) * hasTerrain;

  float bandCoreness = bandCore + bandInner * 0.4;
  vec3 bandColor = mix(uBorderColorOuter, uBorderColorCore, clamp(bandCoreness, 0.0, 1.0));
  float borderAlpha = bandIntensity * uBorderOpacity;

  // === SHELL + SILHOUETTE ===
  // Behind-terrain fade applies only to shell/silhouette, not to the
  // terrain-surface intersection band.
  float pixelScale = fragLinear / 80.0;
  float behindW = uBorderWidth * pixelScale;
  float behindFade = smoothstep(-behindW * 4.0, 0.0, depthDiff);
  behindFade = max(behindFade, 0.35);
  behindFade = mix(1.0, behindFade, hasTerrain);

  // Shell
  float shellBase = mix(0.14, 0.45, fresnel);
  float exposedMix = smoothstep(-behindW * 0.5, behindW * 0.5, depthDiff);
  exposedMix = mix(exposedMix, 1.0, 1.0 - hasTerrain);
  float shellAlpha = mix(shellBase * 0.35, shellBase, exposedMix) * uShellOpacity;
  if (!gl_FrontFacing) shellAlpha *= 0.6;

  // Silhouette outline: combine two complementary methods.
  // 1) NdotV rim -- curved surfaces (sphere, capsule).
  float rimSil = 1.0 - smoothstep(0.0, 0.25, NdotV);
  // 2) Geometric edge distance -- hard edges (cube edges).
  float edgeDist = 1000.0;
  vec3 dd = vWorldPosition - uBrushCenter;
  vec3 ad = abs(dd);
  if (uBrushShape > 0.5 && uBrushShape < 1.5) {
    float median = max(min(ad.x, ad.y), min(max(ad.x, ad.y), ad.z));
    edgeDist = uBrushRadius - median;
  }
  float edgeOutlineW = max(uBrushRadius * 0.06, 0.2);
  float edgeSil = 1.0 - smoothstep(0.0, edgeOutlineW, edgeDist);
  float silhouette = max(rimSil, edgeSil);
  float silhouetteAlpha = silhouette * 0.9;
  vec3 silhouetteColor = mix(uBorderColorCore, uBorderColorOuter, 0.3);

  // Mesh contribution (shell + silhouette) with behind-terrain fade
  vec3 meshColor = mix(uShellColor, silhouetteColor, clamp(silhouette, 0.0, 1.0));
  float meshAlpha = max(shellAlpha, silhouetteAlpha) * behindFade;

  // === COMPOSITE ===
  // Terrain band renders at full strength (it IS on the terrain surface).
  float alpha = max(meshAlpha, borderAlpha);
  float bandMix = clamp(borderAlpha / max(alpha, 0.001), 0.0, 1.0);
  vec3 color = mix(meshColor, bandColor, bandMix);

  if (alpha < 0.002) discard;

  gl_FragColor = vec4(color, alpha);
}
