export const EXAMPLES_FOLDER = "__examples__";

export interface ExampleFile {
  path: string;
  content: string;
}

export interface ExampleDefinition {
  folder: string;
  files: ExampleFile[];
}
