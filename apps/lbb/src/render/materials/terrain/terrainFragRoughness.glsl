#include <roughnessmap_fragment>
{
  float slope = slopeMask(vWorldNormal);
  float n = snoise3(vWorldPosition * noiseScale);
  roughnessFactor = roughnessBase + n * roughnessVariation;
  roughnessFactor += slope * 0.05;
  roughnessFactor = clamp(roughnessFactor, 0.0, 1.0);
}
