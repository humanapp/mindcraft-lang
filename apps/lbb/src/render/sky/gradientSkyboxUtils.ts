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

const G1: GradientStop[] = [
  { position: 0.0, color: "#EAF7E0" },
  { position: 0.3, color: "#89F1BF" },
  { position: 0.66, color: "#3BD5EA" },
  { position: 1.0, color: "#079DB9" },
  { position: 1.0, color: "#000000" },
];

const G2: GradientStop[] = [
  { position: 0.0, color: "#EAAEFF" },
  { position: 0.41, color: "#FFFFF8" },
  { position: 0.77, color: "#9B97E4" },
  { position: 1.0, color: "#5F5E9E" },
  { position: 1.0, color: "#000000" },
];

const G3: GradientStop[] = [
  { position: 0.0, color: "#F5DDF0" },
  { position: 0.39, color: "#F3F3EB" },
  { position: 0.75, color: "#B8BEC3" },
  { position: 1.0, color: "#546871" },
  { position: 1.0, color: "#000000" },
];

const G4: GradientStop[] = [
  { position: 0.0, color: "#F1CDFD" },
  { position: 0.37, color: "#FDFDF6" },
  { position: 0.77, color: "#9894E3" },
  { position: 1.0, color: "#5F5E9E" },
  { position: 1.0, color: "#000000" },
];

const G5: GradientStop[] = [
  { position: 0.0, color: "#EAF7E1" },
  { position: 0.24, color: "#93F3BE" },
  { position: 0.6, color: "#41D9EB" },
  { position: 1.0, color: "#079EB9" },
  { position: 1.0, color: "#000000" },
];

const G6: GradientStop[] = [
  { position: 0.0, color: "#747574" },
  { position: 0.24, color: "#93F3BE" },
  { position: 0.61, color: "#4E8990" },
  { position: 1.0, color: "#362F49" },
  { position: 1.0, color: "#000000" },
];

const G7: GradientStop[] = [
  { position: 0.0, color: "#FEFFE6" },
  { position: 0.24, color: "#C2EEE8" },
  { position: 0.61, color: "#3AA9FF" },
  { position: 1.0, color: "#2F54CC" },
  { position: 1.0, color: "#000000" },
];

const G8: GradientStop[] = [
  { position: 0.13, color: "#B1EDD0" },
  { position: 0.3, color: "#FCFBE5" },
  { position: 0.53, color: "#0E83F8" },
  { position: 0.77, color: "#FF346F" },
  { position: 1.0, color: "#15346F" },
];

const G9: GradientStop[] = [
  { position: 0.0, color: "#000000" },
  { position: 0.15, color: "#232849" },
  { position: 0.24, color: "#F98774" },
  { position: 0.47, color: "#8A66A0" },
  { position: 0.71, color: "#6CB0E9" },
];

const G10: GradientStop[] = [
  { position: 0.09, color: "#000000" },
  { position: 0.13, color: "#F9F6A5" },
  { position: 0.38, color: "#F1B04B" },
  { position: 0.55, color: "#E96464" },
  { position: 1.0, color: "#334A63" },
];

const G11: GradientStop[] = [
  { position: 0.15, color: "#51FFAB" },
  { position: 0.32, color: "#F3FFCD" },
  { position: 0.38, color: "#EBFFAC" },
  { position: 0.54, color: "#FDAFAF" },
  { position: 0.74, color: "#009492" },
];

export const SKY_GRADIENTS = {
  "Lavender Sunset": DEFAULT_GRADIENT,
  "Mint Sea Horizon": G1,
  "Lilac Dream": G2,
  "Silver Overcast": G3,
  "Orchid Twilight": G4,
  "Tropical Sky": G5,
  "Stormlit Teal": G6,
  "Clear Summer Day": G7,
  "Atmospheric Haze": G8,
  "Neon Dusk": G9,
  "Molten Sunset": G10,
  "Aurora Garden": G11,
};

export type SkyGradientId = keyof typeof SKY_GRADIENTS;

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

const _evalColor = new Color();
const _mixColor = new Color();

export function evaluateGradient(
  stops: PreparedStops,
  h: number,
  exponent: number,
  offset: number,
  out?: Color
): Color {
  const result = out ?? new Color();
  let t = Math.max(0, Math.min(1, h + offset));
  t = t ** exponent;

  result.copy(stops.colors[0]);
  for (let i = 1; i < stops.count; i++) {
    const segLen = stops.positions[i] - stops.positions[i - 1];
    const frac =
      segLen > 0 ? Math.max(0, Math.min(1, (t - stops.positions[i - 1]) / segLen)) : t >= stops.positions[i] ? 1 : 0;
    _mixColor.copy(stops.colors[i]);
    result.lerp(_mixColor, frac);
  }

  return result;
}

export function getHorizonColor(stops: PreparedStops, exponent: number, offset: number, out?: Color): Color {
  return evaluateGradient(stops, 0.5, exponent, offset, out);
}
