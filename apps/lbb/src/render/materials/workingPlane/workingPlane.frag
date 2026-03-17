uniform vec3 uCursorPos;
uniform float uFalloffRadius;
uniform float uOpacityScale;
uniform vec3 uColor;
uniform float uMinorSpacing;
uniform float uMajorMultiplier;

varying vec3 vWorldPosition;
varying vec2 vPlaneCoord;

float gridFactor(vec2 coord, float spacing) {
  vec2 uv = coord / spacing;
  vec2 grid = abs(fract(uv - 0.5) - 0.5);
  vec2 fw = fwidth(uv);
  vec2 line = smoothstep(fw * 1.5, fw * 0.5, grid);
  return max(line.x, line.y);
}

void main() {
  float minor = gridFactor(vPlaneCoord, uMinorSpacing);
  float major = gridFactor(vPlaneCoord, uMinorSpacing * uMajorMultiplier);

  float grid = max(minor * 0.3, major * 0.7);
  float fill = 0.025;
  float intensity = max(grid, fill);

  float dist = distance(vWorldPosition, uCursorPos);
  float falloff = 1.0 - smoothstep(0.0, uFalloffRadius, dist);

  float alpha = intensity * falloff * uOpacityScale;
  if (alpha < 0.002) discard;

  gl_FragColor = vec4(uColor, alpha);
}
