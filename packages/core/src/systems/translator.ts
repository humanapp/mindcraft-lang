/** Translates a message key (or source string) to localized text. */
export interface ITranslator {
  tr(keyOrSource: string, args?: Record<string, unknown>): string;
}
