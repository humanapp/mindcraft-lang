varying vec3 vWorldPosition;
varying vec2 vPlaneCoord;

void main() {
  vPlaneCoord = position.xz;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
