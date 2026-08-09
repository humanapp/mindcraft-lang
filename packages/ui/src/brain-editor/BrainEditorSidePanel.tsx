import { type ReactNode, useEffect, useState } from "react";
import { kSidePanelRegionId, sidePanelRegionClasses, standsSidePanelContent } from "./side-panel";

/** Props for {@link BrainEditorSidePanel}. */
export interface BrainEditorSidePanelProps {
  /** Whether the region stands open. */
  isOpen: boolean;
  /** What the region holds, put in on its first open. */
  content: ReactNode;
}

/**
 * The region the editor lays out beside its rules, holding whatever the host
 * put in it. It claims its width from the rules while it stands open and none
 * at all while it is closed.
 */
export function BrainEditorSidePanel({ isOpen, content }: BrainEditorSidePanelProps) {
  const [hasBeenOpened, setHasBeenOpened] = useState(isOpen);

  useEffect(() => {
    if (isOpen) setHasBeenOpened(true);
  }, [isOpen]);

  return (
    <div id={kSidePanelRegionId} className={sidePanelRegionClasses(isOpen)}>
      {standsSidePanelContent(isOpen, hasBeenOpened) && content}
    </div>
  );
}
