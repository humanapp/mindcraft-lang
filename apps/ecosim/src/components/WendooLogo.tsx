/**
 * The Wendoo mark and logotype as inline SVG. Both draw in `currentColor`, so
 * set the color on the embedding element. The geometry mirrors
 * `branding/logo/wendoo-mark.svg` and `branding/logo/wendoo-logotype.svg` at
 * the repository root; keep the two in step.
 */

interface WendooLogoProps {
  /** Classes applied to the root `<svg>`; size it with height and `w-auto`. */
  className?: string;
}

/** The DO tile of the mark: a solid tile with the pupil knocked out, on the 24-unit master grid. */
const MARK_PATH_DO =
  "M15.8 7h4.4a2.8 2.8 0 0 1 2.8 2.8v4.4a2.8 2.8 0 0 1-2.8 2.8h-4.4a2.8 2.8 0 0 1-2.8-2.8v-4.4a2.8 2.8 0 0 1 2.8-2.8ZM20.45 11.6a1.9 1.9 0 1 1-3.8 0a1.9 1.9 0 1 1 3.8 0Z";

/** The tile pair at the end of the logotype, same geometry as the mark shifted 53 units right. */
const LOGOTYPE_PATH_DO =
  "M68.8 7h4.4a2.8 2.8 0 0 1 2.8 2.8v4.4a2.8 2.8 0 0 1-2.8 2.8h-4.4a2.8 2.8 0 0 1-2.8-2.8v-4.4a2.8 2.8 0 0 1 2.8-2.8ZM73.45 11.6a1.9 1.9 0 1 1-3.8 0a1.9 1.9 0 1 1 3.8 0Z";

/** The mark alone: two tiles with eyes. Square, use at 24px and above. Decorative; label the parent. */
export function WendooMark({ className }: WendooLogoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="2" y="8" width="8" height="8" rx="1.8" stroke="currentColor" strokeWidth="2" />
      <circle cx="6.55" cy="11.6" r="1.9" fill="currentColor" />
      <path fillRule="evenodd" fill="currentColor" d={MARK_PATH_DO} />
    </svg>
  );
}

/** The tile-native "wendoo" logotype, 78 x 19 units. At 28px tall it is 115px wide. Decorative; label the parent. */
export function WendooLogotype({ className }: WendooLogoProps) {
  return (
    <svg viewBox="0 0 78 19" fill="none" aria-hidden="true" className={className}>
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 8V14.2a1.8 1.8 0 0 0 1.8 1.8h2.4a1.8 1.8 0 0 0 1.8-1.8V11V14.2a1.8 1.8 0 0 0 1.8 1.8h2.4a1.8 1.8 0 0 0 1.8-1.8V8" />
        <path d="M26 16h-5.2a1.8 1.8 0 0 1-1.8-1.8v-4.4a1.8 1.8 0 0 1 1.8-1.8h4.4a1.8 1.8 0 0 1 1.8 1.8V12H19" />
        <path d="M31 16V9.8a1.8 1.8 0 0 1 1.8-1.8h4.4a1.8 1.8 0 0 1 1.8 1.8V16" />
        <path d="M51 3V14.2a1.8 1.8 0 0 1-1.8 1.8h-4.4a1.8 1.8 0 0 1-1.8-1.8v-4.4a1.8 1.8 0 0 1 1.8-1.8H51" />
      </g>
      <rect x="55" y="8" width="8" height="8" rx="1.8" stroke="currentColor" strokeWidth="2" />
      <circle cx="59.55" cy="11.6" r="1.9" fill="currentColor" />
      <path fillRule="evenodd" fill="currentColor" d={LOGOTYPE_PATH_DO} />
    </svg>
  );
}
