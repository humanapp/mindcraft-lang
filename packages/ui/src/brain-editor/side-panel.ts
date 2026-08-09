import { kSidePanelLayer } from "./editor-layers";

/** The id the editor's side region carries, which its toolbar toggle names as the region it controls. */
export const kSidePanelRegionId = "brain-editor-side-panel";

/**
 * Whether the side region holds its content, given whether it stands open now
 * and whether it has stood open before. Content is put in on the first open and
 * kept from then on.
 */
export function standsSidePanelContent(isOpen: boolean, hasBeenOpened: boolean): boolean {
  return isOpen || hasBeenOpened;
}

/** What the region carries whatever it stands: its width, its column, and its step. */
const regionClasses = `hidden min-h-0 w-80 shrink-0 flex-col overflow-hidden ${kSidePanelLayer}`;

/**
 * The classes the side region carries while it stands `isOpen`. A closed region
 * is laid out nowhere, so what it holds takes no space, no pointer and no
 * keyboard; an open one lays out only from the width the editor has room for
 * both it and the rules at.
 */
export function sidePanelRegionClasses(isOpen: boolean): string {
  return isOpen ? `${regionClasses} lg:flex` : regionClasses;
}
