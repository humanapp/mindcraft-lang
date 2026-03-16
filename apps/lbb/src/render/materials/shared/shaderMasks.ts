export const glslSlopeMask = /* glsl */ `
// Returns 0 for flat surfaces (normal pointing up), 1 for vertical/overhangs
float slopeMask(vec3 normal) {
  return 1.0 - clamp(normal.y, 0.0, 1.0);
}
`;

export const glslHeightMask = /* glsl */ `
// Returns 0..1 blend factor based on world-space Y between yMin and yMax
float heightMask(float worldY, float yMin, float yMax) {
  return clamp((worldY - yMin) / max(yMax - yMin, 0.001), 0.0, 1.0);
}
`;
