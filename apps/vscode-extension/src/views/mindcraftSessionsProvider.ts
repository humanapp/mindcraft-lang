import * as vscode from "vscode";
import { MINDCRAFT_EXAMPLE_SCHEME } from "../services/mindcraft-example-fs-provider";
import { EXAMPLES_FOLDER } from "../services/mindcraft-fs-provider";
import type { ProjectManager } from "../services/project-manager";

type TreeItem = SessionItem | ExamplesFolderItem | ExampleGroupItem | ExampleFileItem | ExampleCopyItem;

export class MindcraftSessionsProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly projectManager: ProjectManager) {
    projectManager.onDidChangeProject(() => this.refresh());
    projectManager.onDidChangeStatus(() => this.refresh());
    projectManager.fsProvider.onDidChangeFile(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): TreeItem[] {
    if (!element) {
      return this.getRootChildren();
    }
    if (element instanceof ExamplesFolderItem) {
      return this.getExampleGroups();
    }
    if (element instanceof ExampleGroupItem) {
      return this.getExampleGroupChildren(element.folder);
    }
    return [];
  }

  private getRootChildren(): TreeItem[] {
    const project = this.projectManager.project;
    if (!project) {
      return [
        new SessionItem("Connect to Mindcraft...", vscode.TreeItemCollapsibleState.None, "mindcraft.connect", "plug"),
        new SessionItem(
          "Open settings",
          vscode.TreeItemCollapsibleState.None,
          "mindcraft.openSettings",
          "settings-gear"
        ),
      ];
    }

    const items: TreeItem[] = [
      new SessionItem(
        "Disconnect",
        vscode.TreeItemCollapsibleState.None,
        "mindcraft.confirmDisconnect",
        "debug-disconnect"
      ),
      new SessionItem("Create new sensor", vscode.TreeItemCollapsibleState.None, "mindcraft.createSensor", "eye"),
      new SessionItem("Create new actuator", vscode.TreeItemCollapsibleState.None, "mindcraft.createActuator", "zap"),
      new SessionItem("Open settings", vscode.TreeItemCollapsibleState.None, "mindcraft.openSettings", "settings-gear"),
    ];

    if (this.hasExamples()) {
      items.push(new ExamplesFolderItem());
    }

    return items;
  }

  private getExampleGroups(): TreeItem[] {
    const fs = this.projectManager.project?.files.raw;
    if (!fs) return [];

    try {
      const entries = fs.list(EXAMPLES_FOLDER);
      return entries
        .filter((e) => e.kind === "directory")
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => new ExampleGroupItem(e.name));
    } catch {
      return [];
    }
  }

  private getExampleGroupChildren(folder: string): TreeItem[] {
    const fs = this.projectManager.project?.files.raw;
    if (!fs) return [];

    try {
      const entries = fs.list(`${EXAMPLES_FOLDER}/${folder}`);
      const items: TreeItem[] = entries
        .filter((e) => e.kind === "file")
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => new ExampleFileItem(folder, e.name));

      items.push(new ExampleCopyItem(folder));
      return items;
    } catch {
      return [];
    }
  }

  private hasExamples(): boolean {
    const fs = this.projectManager.project?.files.raw;
    if (!fs) return false;

    try {
      const entries = fs.list(EXAMPLES_FOLDER);
      return entries.some((e) => e.kind === "directory");
    } catch {
      return false;
    }
  }
}

class SessionItem extends vscode.TreeItem {
  constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState, commandId?: string, icon?: string) {
    super(label, collapsibleState);
    if (commandId) {
      this.command = { command: commandId, title: label };
    }
    if (icon) {
      this.iconPath = new vscode.ThemeIcon(icon);
    }
  }
}

class ExamplesFolderItem extends vscode.TreeItem {
  constructor() {
    super("Examples", vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon("library");
    this.contextValue = "examplesFolder";
  }
}

class ExampleGroupItem extends vscode.TreeItem {
  constructor(readonly folder: string) {
    super(folder, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon("file-code");
    this.contextValue = "exampleGroup";
    const mdUri = vscode.Uri.from({
      scheme: MINDCRAFT_EXAMPLE_SCHEME,
      path: `/${folder}/${folder.toLowerCase()}.md`,
    });
    this.command = {
      command: "markdown.showPreview",
      title: "Preview",
      arguments: [mdUri],
    };
  }
}

class ExampleFileItem extends vscode.TreeItem {
  constructor(folder: string, fileName: string) {
    super(fileName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "exampleFile";
    this.resourceUri = vscode.Uri.from({
      scheme: MINDCRAFT_EXAMPLE_SCHEME,
      path: `/${folder}/${fileName}`,
    });
    this.command = {
      command: "vscode.open",
      title: "Open",
      arguments: [this.resourceUri],
    };
  }
}

class ExampleCopyItem extends vscode.TreeItem {
  constructor(folder: string) {
    super("Copy to Workspace", vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon("cloud-download");
    this.contextValue = "exampleCopy";
    this.command = {
      command: "mindcraft.copyExampleToWorkspace",
      title: "Copy to Workspace",
      arguments: [folder],
    };
  }
}
