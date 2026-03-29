import type { ExportedFileSystem } from "@mindcraft-lang/bridge-client";
import { Project, type ProjectOptions } from "@mindcraft-lang/bridge-client";
import type { AppClientMessage, AppServerMessage } from "@mindcraft-lang/bridge-protocol";

export interface AppProjectOptions {
  appName: string;
  projectId: string;
  projectName: string;
  bridgeUrl: string;
  filesystem: ExportedFileSystem;
}

export class AppProject extends Project<AppClientMessage, AppServerMessage> {
  private _joinCode: string | undefined;
  private readonly _joinCodeListeners = new Set<(joinCode: string | undefined) => void>();
  private readonly _sessionUnsubs: (() => void)[] = [];

  constructor(options: AppProjectOptions) {
    const projectOptions: ProjectOptions<AppClientMessage, AppServerMessage> = {
      ...options,
      wsPath: "app",
    };
    super(projectOptions);
    this.wireJoinCode();
  }

  get joinCode(): string | undefined {
    return this._joinCode;
  }

  onJoinCodeChange(fn: (joinCode: string | undefined) => void): () => void {
    this._joinCodeListeners.add(fn);
    return () => {
      this._joinCodeListeners.delete(fn);
    };
  }

  private wireJoinCode(): void {
    this._sessionUnsubs.push(
      this.session.on("session:welcome", (msg) => {
        this.setJoinCode(msg.payload.joinCode);
      })
    );
    this._sessionUnsubs.push(
      this.session.on("session:joinCode", (msg) => {
        this.setJoinCode(msg.payload.joinCode);
      })
    );
  }

  private setJoinCode(joinCode: string | undefined): void {
    if (this._joinCode === joinCode) return;
    this._joinCode = joinCode;
    for (const fn of this._joinCodeListeners) {
      fn(joinCode);
    }
  }
}
