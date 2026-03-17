varying vec3 vWorldDirection;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldDirection = normalize(worldPos.xyz - cameraPosition);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
