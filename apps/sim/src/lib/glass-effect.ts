import type { CSSProperties } from "react";

/**
 * Generates CSS styles for a glass-like glint effect.
 *
 * Two pieces are returned:
 *  - `containerStyle`: inset box-shadows to apply on the element itself (merge into your existing style).
 *  - `overlayStyle`: a background gradient to render via an absolutely-positioned child/span.
 *
 * Usage:
 *   const glass = glassEffect({ /- options -/ });
 *   <div style={{ ...myStyle, ...glass.containerStyle }}>
 *     <span className="absolute inset-0 rounded-lg pointer-events-none" style={glass.overlayStyle} aria-hidden="true" />
 *     ...children
 *   </div>
 */

export interface GlassEffectOptions {
  /** Overall intensity multiplier (0-1). Scales all opacity values. Default: 1. */
  intensity?: number;

  // -- Inset shadow (edge bevel) --

  /** Opacity of the bright highlight inset shadow (top-left). Default: 0.35. */
  highlightStrength?: number;

  /** Opacity of the dark inset shadow (bottom-right). Default: 0.12. */
  shadowStrength?: number;

  /** Size of the bright inset shadow in px. Default: 3. */
  highlightSize?: number;

  /** Size of the dark inset shadow in px. Default: 2. */
  shadowSize?: number;

  // -- Top reflection band --

  /** Opacity of the horizontal reflection band near the top. Default: 0.3. */
  bandOpacity?: number;

  /** Where the band starts (% from top). Default: 0. */
  bandStart?: number;

  /** Where the band peaks (% from top). Default: 15. */
  bandPeak?: number;

  /** Where the band fades out (% from top). Default: 40. */
  bandEnd?: number;

  // -- Bottom reflection --

  /** Opacity of the subtle bottom-edge reflection. Default: 0.08. */
  bottomReflection?: number;

  /** Where the bottom reflection starts fading in (% from top). Default: 85. */
  bottomStart?: number;

  // -- Top-to-bottom shade --

  /** Opacity of the top-to-bottom darkening gradient. Default: 0.1. */
  verticalShade?: number;

  // -- Corner accents --

  /** Opacity of the bright corner radial highlight. Default: 0.15. */
  cornerHighlight?: number;

  /** Position of the bright corner as [x%, y%]. Default: [15, 8]. */
  cornerHighlightPos?: [number, number];

  /** Radius (%) of the corner highlight gradient. Default: 50. */
  cornerRadius?: number;

  /** Opacity of the dark corner radial shadow. Default: 0.06. */
  cornerShadow?: number;

  /** Position of the dark corner as [x%, y%]. Default: [85, 92]. */
  cornerShadowPos?: [number, number];

  /** Optional extra inset box-shadow string to prepend (e.g. a border ring). */
  extraInsetShadow?: string;
}

export interface GlassEffect {
  /** Merge into the element's `style` prop. Contains inset box-shadows. */
  containerStyle: CSSProperties;

  /** Apply to an absolutely-positioned overlay child. Contains the glint gradient background. */
  overlayStyle: CSSProperties;
}

export function glassEffect(options: GlassEffectOptions = {}): GlassEffect {
  const {
    intensity = 1,
    highlightStrength = 0.35,
    shadowStrength = 0.12,
    highlightSize = 3,
    shadowSize = 2,
    bandOpacity = 0.3,
    bandStart = 0,
    bandPeak = 15,
    bandEnd = 40,
    bottomReflection = 0.08,
    bottomStart = 85,
    verticalShade = 0.1,
    cornerHighlight = 0.15,
    cornerHighlightPos = [15, 8],
    cornerRadius = 50,
    cornerShadow = 0.06,
    cornerShadowPos = [85, 92],
    extraInsetShadow,
  } = options;

  const s = (v: number) => Math.round(v * intensity * 1000) / 1000; // scale + round

  // -- Inset box-shadows --
  const offset = Math.round(highlightSize * 0.5);
  const shadowOffset = Math.round(shadowSize * 0.5);
  const shadows = [
    extraInsetShadow,
    `inset ${offset}px ${offset}px ${highlightSize}px rgba(255,255,255,${s(highlightStrength)})`,
    `inset -${shadowOffset}px -${shadowOffset}px ${shadowSize}px rgba(0,0,0,${s(shadowStrength)})`,
  ]
    .filter(Boolean)
    .join(", ");

  // -- Overlay gradient layers (bottom to top in visual stacking) --

  // 1. Horizontal reflection band near the top (the key "glass" feature)
  const band = `linear-gradient(180deg, rgba(255,255,255,${s(bandOpacity * 0.5)}) ${bandStart}%, rgba(255,255,255,${s(bandOpacity)}) ${bandPeak}%, transparent ${bandEnd}%)`;

  // 2. Subtle bottom-edge reflection
  const bottom = `linear-gradient(0deg, rgba(255,255,255,${s(bottomReflection)}) 0%, transparent ${100 - bottomStart}%)`;

  // 3. Vertical shade (top light -> bottom slightly darker)
  const shade = `linear-gradient(180deg, transparent 40%, rgba(0,0,0,${s(verticalShade)}) 100%)`;

  // 4. Corner accents
  const brightCorner = `radial-gradient(ellipse at ${cornerHighlightPos[0]}% ${cornerHighlightPos[1]}%, rgba(255,255,255,${s(cornerHighlight)}) 0%, transparent ${cornerRadius}%)`;
  const darkCorner = `radial-gradient(ellipse at ${cornerShadowPos[0]}% ${cornerShadowPos[1]}%, rgba(0,0,0,${s(cornerShadow)}) 0%, transparent ${cornerRadius}%)`;

  return {
    containerStyle: {
      boxShadow: shadows,
    },
    overlayStyle: {
      background: [band, bottom, shade, brightCorner, darkCorner].join(", "),
    },
  };
}
