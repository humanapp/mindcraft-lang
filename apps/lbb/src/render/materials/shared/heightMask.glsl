// Returns 0..1 blend factor based on world-space Y between yMin and yMax
float heightMask(float worldY, float yMin, float yMax) {
  return clamp((worldY - yMin) / max(yMax - yMin, 0.001), 0.0, 1.0);
}
