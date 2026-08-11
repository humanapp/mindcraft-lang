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

/**
 * The accessible name the control toggling the side region carries, for a
 * region the host calls `label`. Falls back to a generic name when `label` is
 * absent or empty.
 */
export function sidePanelToggleLabel(label: string | undefined): string {
  return label ? `Toggle ${label}` : "Toggle side panel";
}

/**
 * The classes the box holding the rules and the side region carries. It stands
 * them in one column, the rules above the region, until the editor is wide
 * enough for both side by side, where it turns into a row. It grows into the
 * space the editor leaves between its header and its buttons.
 */
export const kSidePanelLayoutClasses = "flex grow min-h-0 flex-col gap-2 sm:gap-3 lg:flex-row";

/** What the region carries whatever it stands: its column, its own overflow, and its step. */
const regionClasses = `min-h-0 flex-col overflow-hidden ${kSidePanelLayer}`;

/**
 * What an open region takes of the editor: a share of the height it is stacked
 * in, and a column of the editor's width, at its own side of the rules, from
 * the width there is room for both at.
 */
const openRegionClasses = "flex shrink-0 grow-0 basis-[45%] lg:order-first lg:w-80 lg:basis-auto";

/**
 * The classes the side region carries while it stands `isOpen`. A closed region
 * is laid out nowhere, so what it holds takes no space, no pointer and no
 * keyboard. An open one stands at every width: below the rules while the editor
 * is too narrow to hold both across, and beside them once it is wide enough.
 */
export function sidePanelRegionClasses(isOpen: boolean): string {
  return isOpen ? `${openRegionClasses} ${regionClasses}` : `hidden ${regionClasses}`;
}
