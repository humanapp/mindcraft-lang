#include "../shared/noise.glsl"
#include "../shared/slopeMask.glsl"
#include "../shared/heightMask.glsl"

uniform vec3 lowColor;
uniform vec3 highColor;
uniform vec3 steepColor;
uniform float heightMin;
uniform float heightMax;
uniform float noiseScale;
uniform float noiseStrength;
uniform float roughnessBase;
uniform float roughnessVariation;
uniform float seaLevel;
uniform vec3 hazeColor;
uniform float hazeHeight;
uniform float hazeStrength;
uniform float hazeNear;
uniform float hazeFar;
uniform float hazeSlopeBoost;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
