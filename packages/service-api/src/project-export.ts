export interface MindcraftExportHost {
  name: string;
  version: string;
}

export interface MindcraftExportFile {
  path: string;
  content: string;
}

export interface MindcraftExportCommon {
  host: MindcraftExportHost;
  name: string;
  description: string;
  files: MindcraftExportFile[];
  brains: Record<string, unknown>;
}

export interface MindcraftExportDocument extends MindcraftExportCommon {
  app?: unknown;
}
