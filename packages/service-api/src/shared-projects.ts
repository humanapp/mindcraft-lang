export interface SharedProjectHostInfo {
  name: string;
  version: string;
}

export interface SharedProject {
  projectId: string;
  title: string;
  description: string;
  host: SharedProjectHostInfo;
  latestRevisionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SharedProjectRevision {
  revisionId: string;
  projectId: string;
  createdAt: string;
  payloadBlobKey: string;
  payloadSha256?: string;
  sizeBytes?: number;
}
