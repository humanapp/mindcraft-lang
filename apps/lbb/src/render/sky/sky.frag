#define MAX_STOPS 8

uniform vec3 uColors[MAX_STOPS];
uniform float uPositions[MAX_STOPS];
uniform int uStopCount;
uniform float uExponent;
uniform float uOffset;

varying vec3 vWorldDirection;

void main() {
  float h = normalize(vWorldDirection).y * 0.5 + 0.5;
  h = clamp(h + uOffset, 0.0, 1.0);
  h = pow(h, uExponent);

  vec3 col = uColors[0];
  for (int i = 1; i < MAX_STOPS; i++) {
    if (i >= uStopCount) break;
    float segLen = uPositions[i] - uPositions[i - 1];
    float t = segLen > 0.0
      ? clamp((h - uPositions[i - 1]) / segLen, 0.0, 1.0)
      : (h >= uPositions[i] ? 1.0 : 0.0);
    col = mix(col, uColors[i], t);
  }

  gl_FragColor = vec4(col, 1.0);
}
