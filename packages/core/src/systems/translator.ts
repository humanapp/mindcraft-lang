export interface ITranslator {
  tr(keyOrSource: string, args?: Record<string, unknown>): string;
}
