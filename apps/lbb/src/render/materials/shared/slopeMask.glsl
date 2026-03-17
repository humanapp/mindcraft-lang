// Returns 0 for flat surfaces (normal pointing up), 1 for vertical/overhangs
float slopeMask(vec3 normal) {
  return 1.0 - clamp(normal.y, 0.0, 1.0);
}
