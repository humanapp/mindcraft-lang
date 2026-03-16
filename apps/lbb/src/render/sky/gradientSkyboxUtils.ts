import { Color, type ColorRepresentation } from "three";
import { MAX_STOPS, type PreparedStops } from "./gradientSkyboxMaterial";

export type GradientStop = {
  position: number;
  color: ColorRepresentation;
};

const DEFAULT_GRADIENT: GradientStop[] = [
  { position: 0.0, color: "#1b2a6b" },
  { position: 0.5, color: "#7b6aad" },
  { position: 0.8, color: "#c87e9a" },
  { position: 1.0, color: "#f0a96e" },
];

export function prepareStops(input: GradientStop[] | undefined): PreparedStops {
  const raw = input && input.length > 0 ? input : DEFAULT_GRADIENT;
  const sorted = raw.slice().sort((a, b) => a.position - b.position);
  const clamped = sorted.slice(0, MAX_STOPS);

  const colors: Color[] = [];
  const positions: number[] = [];

  for (const stop of clamped) {
    colors.push(new Color(stop.color));
    positions.push(Math.max(0, Math.min(1, stop.position)));
  }

  return { colors, positions, count: colors.length };
}
