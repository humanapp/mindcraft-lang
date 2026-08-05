/**
 * The type the rule sentence is read in, as the Tailwind utilities that set it:
 * the shared old-style serif face, at reading size and measure.
 *
 * Every element standing inline in the sentence carries it -- the line, each of
 * its tappable words, and the composer's input hosted among them -- which keeps
 * text being typed set identically to text already committed. An app may name a
 * different face by setting `--font-brain-sentence`.
 */
export const kSentenceTypeClasses = "font-brain-sentence text-lg leading-relaxed";
