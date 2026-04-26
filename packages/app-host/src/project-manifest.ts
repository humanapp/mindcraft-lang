export interface ProjectManifest {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly thumbnailUrl?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}
