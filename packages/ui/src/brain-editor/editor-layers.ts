/**
 * The stacking steps the brain editor draws its layers at, lowest first, each
 * as the Tailwind z-index utility its element carries.
 *
 * The rule list shares one stacking context, so a step taken inside one rule
 * card compares directly against the same step inside any other. The offering's
 * rail is a sibling of the whole column of cards and takes the step above all
 * of them, so the offering stands over every card it is laid across. The
 * dialog's own chrome is drawn in the dialog's stacking context, which holds
 * the whole rule list, so it stands above the offering whatever step the
 * offering takes.
 */

/** Rule rows, sentence lines, and a tile's interior, drawn over their own card's fill and overlays. */
export const kRuleContentLayer = "z-10";

/** A tile's corner badges, and a rule card lifted by a drag: the top of a card's own chrome. */
export const kRuleChromeLayer = "z-30";

/** The directional markers a grabbed rule's handle carries, drawn over the chrome they reach across. */
export const kGrabbedRuleMarkerLayer = "z-35";

/** The rail the candidate offering stands in, drawn over every rule card and all of its chrome. */
export const kOfferingLayer = "z-40";

/** The editor dialog's own chrome: its standalone backdrop and its top-edge accent. */
export const kDialogChromeLayer = "z-50";
