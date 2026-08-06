import { cn } from "../lib/utils";

/** Props for {@link LoadingIndicator}. */
export interface LoadingIndicatorProps {
  /**
   * What the region is waiting for, read out by assistive technology and shown
   * beneath the ring. Supply plain prose, already localized.
   */
  label: string;
  /**
   * Extra classes for the container. Set the text colour here: the ring is
   * drawn in `currentColor`, so it takes whatever ink the host region reads in.
   */
  className?: string;
}

/**
 * Busy affordance for a region whose content is still being built. Renders an
 * `output`, a polite live region, carrying `label`, so a screen reader is told
 * the wait has begun; pair it with `aria-busy` on the region it stands in.
 *
 * The ring animates `transform` and nothing else, so it keeps turning while the
 * main thread is blocked building the content.
 */
export function LoadingIndicator({ label, className }: LoadingIndicatorProps) {
  return (
    <output className={cn("flex h-full w-full flex-col items-center justify-center gap-4 p-6 text-center", className)}>
      <span
        aria-hidden="true"
        className="h-10 w-10 shrink-0 animate-spin rounded-full border-4 border-current/25 border-t-current"
      />
      <span className="text-sm">{label}</span>
    </output>
  );
}
