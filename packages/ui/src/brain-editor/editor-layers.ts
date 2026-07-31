/**
 * The stacking steps the brain editor draws its layers at, lowest first, each
 * as the Tailwind z-index utility its element carries.
 *
 * The rule list shares one stacking context, so a step taken inside one rule
 * card compares directly against the same step inside any other: the offering
 * panel stands above the chrome of every card it is laid over, wherever those
 * cards sit in the list. The dialog's own chrome is drawn in the dialog's
 * stacking context, which holds the whole rule list, so it stands above the
 * offering whatever step the offering takes.
 */

/** Rule rows, sentence lines, and a tile's interior, drawn over their own card's glint. */
export const kRuleContentLayer = "z-10";

/** The glass glint laid over a rule card or over a tile. */
export const kRuleGlintLayer = "z-20";

/** A tile's corner badges, and a rule card lifted by a drag: the top of a card's own chrome. */
export const kRuleChromeLayer = "z-30";

/** The candidate offering panel, drawn over every rule card and all of its chrome. */
export const kOfferingLayer = "z-40";

/** The editor dialog's own chrome: its standalone backdrop and its top-edge accent. */
export const kDialogChromeLayer = "z-50";
