import { Color, type IUniform } from "three";

export interface TerrainUniformValues {
  lowColor: Color;
  highColor: Color;
  steepColor: Color;
  heightMin: number;
  heightMax: number;
  noiseScale: number;
  noiseStrength: number;
  roughnessBase: number;
  roughnessVariation: number;
  seaLevel: number;
}

export type TerrainUniformMap = {
  [K in keyof TerrainUniformValues]: IUniform<TerrainUniformValues[K]>;
};

export const TERRAIN_DEFAULTS: TerrainUniformValues = {
  lowColor: new Color("#4c8f3a"),
  highColor: new Color("#7fbf55"),
  steepColor: new Color("#3d6f2c"),
  heightMin: -10,
  heightMax: 60,
  noiseScale: 0.08,
  noiseStrength: 0.08,
  roughnessBase: 0.85,
  roughnessVariation: 0.1,
  seaLevel: -9999,
};

export function createTerrainUniforms(overrides?: Partial<TerrainUniformValues>): TerrainUniformMap {
  const vals = { ...TERRAIN_DEFAULTS, ...overrides };
  return {
    lowColor: { value: vals.lowColor.clone() },
    highColor: { value: vals.highColor.clone() },
    steepColor: { value: vals.steepColor.clone() },
    heightMin: { value: vals.heightMin },
    heightMax: { value: vals.heightMax },
    noiseScale: { value: vals.noiseScale },
    noiseStrength: { value: vals.noiseStrength },
    roughnessBase: { value: vals.roughnessBase },
    roughnessVariation: { value: vals.roughnessVariation },
    seaLevel: { value: vals.seaLevel },
  };
}
