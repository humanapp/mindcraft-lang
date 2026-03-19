{
  // -- height gradient --
  float ht = heightMask(vWorldPosition.y, heightMin, heightMax);
  vec3 terrainColor = mix(lowColor, highColor, ht);

  // -- slope tint --
  float slope = slopeMask(vWorldNormal);
  terrainColor = mix(terrainColor, steepColor, slope * 0.6);

  // -- world-space noise breakup --
  float n = snoise3(vWorldPosition * noiseScale);
  terrainColor *= 1.0 + n * noiseStrength;

  // -- sea level effects --
  float depthBelowSea = seaLevel - vWorldPosition.y;

  // coastal band: darkened wet zone right around sea level
  float coastWet = smoothstep(-1.5, 0.5, depthBelowSea)
                 * (1.0 - smoothstep(0.5, 3.0, depthBelowSea));
  terrainColor *= 1.0 - coastWet * 0.3;

  // underwater: shift toward cool blue-green, reduce contrast
  float underFactor = smoothstep(0.0, 10.0, depthBelowSea);
  vec3 underwaterTint = vec3(0.3, 0.45, 0.55);
  terrainColor = mix(terrainColor,
                     terrainColor * underwaterTint + underwaterTint * 0.12,
                     underFactor * 0.7);

  // -- apply to diffuse --
  diffuseColor.rgb = terrainColor;
}
