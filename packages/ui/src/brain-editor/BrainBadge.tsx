import { type ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { kDialogChromeLayer } from "./editor-layers";

/** How the summary is set, and how far above its badge it stands, in CSS pixels. */
const kTipClasses = "fixed whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg";
const kTipGap = 6;

interface BrainBadgeProps {
  /** The badge's own shape and colour, which the call site owns. */
  readonly className: string;
  /** What the badge reports: its accessible name, and the summary it shows on hover. */
  readonly message: string;
  /** The glyph the badge carries. */
  readonly children: ReactNode;
}

/**
 * A corner badge on a rule's tile or capsule: a glyph carrying `message` as its
 * accessible name, showing that message as a summary while the pointer rests on
 * it.
 *
 * The summary is portaled to the document and placed against the badge's own
 * box, so it stands clear of the scrolling rule list and the editor frame, both
 * of which clip their content.
 */
export function BrainBadge({ className, message, children }: BrainBadgeProps) {
  const badgeRef = useRef<HTMLSpanElement | null>(null);
  // Where the summary stands, taken as the pointer arrives and dropped as it
  // leaves; undefined while nothing is showing.
  const [origin, setOrigin] = useState<{ left: number; top: number } | undefined>(undefined);

  const show = () => {
    const box = badgeRef.current?.getBoundingClientRect();
    if (box !== undefined) setOrigin({ left: box.right, top: box.top - kTipGap });
  };

  return (
    <span
      ref={badgeRef}
      className={className}
      role="img"
      aria-label={message}
      onPointerEnter={show}
      onPointerLeave={() => setOrigin(undefined)}
    >
      {children}
      {origin !== undefined &&
        createPortal(
          <span
            data-brain-badge-tip=""
            className={`${kTipClasses} ${kDialogChromeLayer} pointer-events-none`}
            style={{ left: origin.left, top: origin.top, transform: "translate(-100%, -100%)" }}
          >
            {message}
          </span>,
          document.body
        )}
    </span>
  );
}
