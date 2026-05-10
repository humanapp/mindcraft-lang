import type {
  ProjectCollection,
  ProjectCollectionState,
  ProjectCollectionSummary,
  ProjectCollectionSummaryChange,
} from "@mindcraft-lang/app-host";
import { AppHostError, DEFAULT_PROJECT_COLLECTION_ID } from "@mindcraft-lang/app-host";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Input,
} from "@mindcraft-lang/ui";
import {
  Check,
  ChevronDown,
  Download,
  FolderOpen,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSimEnvironment } from "@/contexts/sim-environment";

interface ProjectHeaderProps {
  projectName: string;
  projectCollectionState: ProjectCollectionState | undefined;
  onBrowseProjects: (collection: ProjectCollection, context?: string) => void;
  onNewProject: () => void;
  onNewWorkspace: () => void;
  onExportProject: () => void;
  onImportProject: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  if (hours < 24) return `Updated ${hours}h ago`;
  if (days === 1) return "Updated yesterday";
  if (days < 30) return `Updated ${days}d ago`;
  return `Created ${new Date(timestamp).toLocaleDateString()}`;
}

function formatProjectCount(projectCount: number): string {
  return projectCount === 1 ? "1 project" : `${projectCount} projects`;
}

function applySummaryChange(
  summaries: ProjectCollectionSummary[],
  change: ProjectCollectionSummaryChange
): ProjectCollectionSummary[] {
  if (change.type === "remove") {
    return summaries.filter((summary) => summary.collection.projectCollectionId !== change.projectCollectionId);
  }
  const index = summaries.findIndex(
    (summary) => summary.collection.projectCollectionId === change.summary.collection.projectCollectionId
  );
  if (index === -1) {
    return [...summaries, change.summary].sort((a, b) => a.collection.createdAt - b.collection.createdAt);
  }
  const next = summaries.slice();
  next[index] = change.summary;
  return next;
}

function getDuplicateNames(summaries: readonly ProjectCollectionSummary[]): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const summary of summaries) {
    counts.set(summary.collection.name, (counts.get(summary.collection.name) ?? 0) + 1);
  }
  const duplicates = new Set<string>();
  for (const [name, count] of counts) {
    if (count > 1) {
      duplicates.add(name);
    }
  }
  return duplicates;
}

function getWorkspaceContext(summary: ProjectCollectionSummary, duplicateNames: ReadonlySet<string>): string {
  if (duplicateNames.has(summary.collection.name)) {
    return formatRelativeTime(summary.collection.updatedAt);
  }
  return formatProjectCount(summary.projectCount);
}

export function ProjectHeader({
  projectName,
  projectCollectionState,
  onBrowseProjects,
  onNewProject,
  onNewWorkspace,
  onExportProject,
  onImportProject,
}: ProjectHeaderProps) {
  const store = useSimEnvironment();
  const [isEditingProject, setIsEditingProject] = useState(false);
  const [projectNameValue, setProjectNameValue] = useState("");
  const [workspaceSummaries, setWorkspaceSummaries] = useState<ProjectCollectionSummary[] | undefined>();
  const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | undefined>();
  const [openWorkspaceActionId, setOpenWorkspaceActionId] = useState<string | undefined>();
  const [workspaceNameValue, setWorkspaceNameValue] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<ProjectCollectionSummary | undefined>();
  const projectInputRef = useRef<HTMLInputElement>(null);
  const workspaceInputRef = useRef<HTMLInputElement>(null);
  const workspaceAcceptButtonRef = useRef<HTMLButtonElement>(null);
  const workspaceCancelButtonRef = useRef<HTMLButtonElement>(null);
  const workspaceDropdownContentRef = useRef<HTMLDivElement>(null);
  const previousRenamingWorkspaceIdRef = useRef<string | undefined>(undefined);
  const pendingWorkspaceFocusIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    store.projectManager
      .watchProjectCollectionSummaries((change) => {
        setWorkspaceSummaries((current) => applySummaryChange(current ?? [], change));
      })
      .then(
        (subscription) => {
          if (!active) {
            subscription.unsubscribe();
            return;
          }
          unsubscribe = subscription.unsubscribe;
          setWorkspaceSummaries(subscription.initial);
        },
        () => {
          if (active) {
            toast.error("Failed to load workspaces");
            setWorkspaceSummaries([]);
          }
        }
      );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [store]);

  useEffect(() => {
    if (isEditingProject) {
      projectInputRef.current?.select();
    }
  }, [isEditingProject]);

  useEffect(() => {
    if (renamingWorkspaceId) {
      workspaceInputRef.current?.select();
    }
  }, [renamingWorkspaceId]);

  useLayoutEffect(() => {
    const previousRenamingWorkspaceId = previousRenamingWorkspaceIdRef.current;
    if (previousRenamingWorkspaceId && !renamingWorkspaceId) {
      pendingWorkspaceFocusIdRef.current = previousRenamingWorkspaceId;
    }
    previousRenamingWorkspaceIdRef.current = renamingWorkspaceId;
  }, [renamingWorkspaceId]);

  useLayoutEffect(() => {
    const pendingWorkspaceFocusId = pendingWorkspaceFocusIdRef.current;
    if (!pendingWorkspaceFocusId || renamingWorkspaceId) {
      return;
    }
    const workspaceRowIsReady =
      workspaceSummaries?.some((summary) => summary.collection.projectCollectionId === pendingWorkspaceFocusId) ??
      false;
    if (!workspaceRowIsReady) {
      return;
    }
    const rows = workspaceDropdownContentRef.current?.querySelectorAll<HTMLButtonElement>("[data-workspace-row-id]");
    const targetRow = rows
      ? Array.from(rows).find((row) => row.dataset.workspaceRowId === pendingWorkspaceFocusId)
      : undefined;
    if (targetRow) {
      targetRow.focus();
      pendingWorkspaceFocusIdRef.current = undefined;
    }
  }, [renamingWorkspaceId, workspaceSummaries]);

  const duplicateWorkspaceNames = useMemo(() => getDuplicateNames(workspaceSummaries ?? []), [workspaceSummaries]);
  const activeWorkspace = projectCollectionState?.activeProjectCollection;
  const activeWorkspaceName = activeWorkspace?.name ?? (projectCollectionState ? "No Workspace" : "Loading Workspace");
  const activeWorkspaceSummary = workspaceSummaries?.find(
    (summary) => summary.collection.projectCollectionId === activeWorkspace?.projectCollectionId
  );
  const activeWorkspaceContext = activeWorkspaceSummary
    ? getWorkspaceContext(activeWorkspaceSummary, duplicateWorkspaceNames)
    : undefined;

  const startEditingProject = useCallback(() => {
    setProjectNameValue(projectName);
    setIsEditingProject(true);
  }, [projectName]);

  const commitProjectRename = useCallback(() => {
    const trimmed = projectNameValue.trim();
    if (trimmed && trimmed !== projectName) {
      store.updateProjectMetadata({ name: trimmed }).catch(() => setProjectNameValue(projectName));
    }
    setIsEditingProject(false);
  }, [projectNameValue, projectName, store]);

  const cancelProjectRename = useCallback(() => {
    setIsEditingProject(false);
  }, []);

  const handleProjectKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        commitProjectRename();
      } else if (e.key === "Escape") {
        cancelProjectRename();
      }
    },
    [commitProjectRename, cancelProjectRename]
  );

  const handleWorkspaceRename = useCallback((summary: ProjectCollectionSummary) => {
    setRenamingWorkspaceId(summary.collection.projectCollectionId);
    setWorkspaceNameValue(summary.collection.name);
  }, []);

  const handleWorkspaceEditTabKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab") {
      return;
    }
    const controls: Array<HTMLElement | null> = [
      workspaceInputRef.current,
      workspaceAcceptButtonRef.current,
      workspaceCancelButtonRef.current,
    ];
    const focusableControls = controls.filter((control): control is HTMLElement => control !== null);
    const activeElement = document.activeElement;
    const activeIndex = activeElement instanceof HTMLElement ? focusableControls.indexOf(activeElement) : -1;
    if (activeIndex === -1) {
      return;
    }
    const nextControl = focusableControls[activeIndex + (e.shiftKey ? -1 : 1)];
    if (!nextControl) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    nextControl.focus();
  }, []);

  const cancelWorkspaceRename = useCallback(() => {
    setRenamingWorkspaceId(undefined);
  }, []);

  const commitWorkspaceRename = useCallback(
    (projectCollectionId: string) => {
      store.projectManager.renameProjectCollection(projectCollectionId, workspaceNameValue).then(
        () => {
          setRenamingWorkspaceId(undefined);
        },
        (error: unknown) => {
          if (error instanceof AppHostError && error.code === "INVALID_PROJECT_COLLECTION_NAME") {
            toast.error(error.message);
            return;
          }
          toast.error("Failed to rename workspace");
        }
      );
    },
    [store, workspaceNameValue]
  );

  const handleWorkspaceKeyDown = useCallback(
    (e: React.KeyboardEvent, projectCollectionId: string) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        commitWorkspaceRename(projectCollectionId);
      } else if (e.key === "Escape") {
        cancelWorkspaceRename();
      }
    },
    [commitWorkspaceRename, cancelWorkspaceRename]
  );

  const confirmWorkspaceDelete = useCallback(() => {
    const candidate = deleteCandidate;
    if (!candidate) {
      return;
    }
    store.projectManager.deleteProjectCollection(candidate.collection.projectCollectionId).then(
      () => {
        setDeleteCandidate(undefined);
      },
      () => {
        toast.error("Failed to delete workspace");
      }
    );
  }, [deleteCandidate, store]);

  return (
    <div className="absolute top-3 left-3 right-16 z-40 flex min-w-0 items-center gap-1 md:right-auto md:max-w-[calc(100%-24rem)]">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-background/80 backdrop-blur border border-border shadow-md hover:bg-background/90"
            aria-label="Project menu"
          >
            <Menu className="w-4 h-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={4}>
          <DropdownMenuItem onSelect={onNewProject}>
            <Plus className="w-4 h-4 mr-2" />
            New Project
          </DropdownMenuItem>
          {activeWorkspace && (
            <DropdownMenuItem
              onSelect={() =>
                onBrowseProjects(
                  activeWorkspace,
                  activeWorkspaceSummary && duplicateWorkspaceNames.has(activeWorkspaceSummary.collection.name)
                    ? activeWorkspaceContext
                    : undefined
                )
              }
            >
              <FolderOpen className="w-4 h-4 mr-2" />
              Browse Projects
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onExportProject}>
            <Download className="w-4 h-4 mr-2" />
            Export Project
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onImportProject}>
            <Upload className="w-4 h-4 mr-2" />
            Import Project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 min-w-0 max-w-56 items-center gap-1.5 rounded-lg border border-border bg-background/80 px-3 text-sm font-medium shadow-md backdrop-blur hover:bg-background/90"
            aria-label={`Workspace: ${activeWorkspaceName}`}
            title={activeWorkspaceName}
          >
            <span className="truncate">{activeWorkspaceName}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent ref={workspaceDropdownContentRef} align="start" sideOffset={4} className="w-72">
          {workspaceSummaries === undefined ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">Loading workspaces...</div>
          ) : (
            workspaceSummaries.map((summary) => {
              const collection = summary.collection;
              const isActive = collection.projectCollectionId === activeWorkspace?.projectCollectionId;
              const isDefault = collection.projectCollectionId === DEFAULT_PROJECT_COLLECTION_ID;
              const deleteDisabledReason = isActive
                ? "Cannot delete the active workspace"
                : isDefault
                  ? "Cannot delete the default workspace"
                  : undefined;
              const isRenaming = renamingWorkspaceId === collection.projectCollectionId;
              const context = getWorkspaceContext(summary, duplicateWorkspaceNames);

              if (isRenaming) {
                return (
                  <div key={collection.projectCollectionId} className="p-2">
                    <div className="flex items-center gap-1" onKeyDownCapture={handleWorkspaceEditTabKeyDown}>
                      <Input
                        ref={workspaceInputRef}
                        value={workspaceNameValue}
                        className="h-8 bg-background text-sm"
                        onChange={(e) => setWorkspaceNameValue(e.target.value)}
                        onKeyDown={(e) => handleWorkspaceKeyDown(e, collection.projectCollectionId)}
                      />
                      <Button
                        ref={workspaceAcceptButtonRef}
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        aria-label={`Save workspace name for ${collection.name}`}
                        onClick={() => commitWorkspaceRename(collection.projectCollectionId)}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        ref={workspaceCancelButtonRef}
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        aria-label={`Cancel renaming ${collection.name}`}
                        onClick={cancelWorkspaceRename}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              }

              return (
                <div key={collection.projectCollectionId} className="flex items-stretch rounded-sm">
                  <DropdownMenuItem asChild className="min-w-0 flex-1 py-2">
                    <button
                      data-workspace-row-id={collection.projectCollectionId}
                      type="button"
                      onClick={() =>
                        onBrowseProjects(collection, duplicateWorkspaceNames.has(collection.name) ? context : undefined)
                      }
                    >
                      <span className="min-w-0 flex-1 text-left">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate">{collection.name}</span>
                          {isActive && (
                            <span className="shrink-0 rounded border border-emerald-200 bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-100">
                              Current
                            </span>
                          )}
                          {isDefault && (
                            <span className="shrink-0 rounded border border-slate-300 bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-800 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
                              Default
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{context}</span>
                      </span>
                    </button>
                  </DropdownMenuItem>
                  <DropdownMenuSub
                    open={openWorkspaceActionId === collection.projectCollectionId}
                    onOpenChange={(open) => setOpenWorkspaceActionId(open ? collection.projectCollectionId : undefined)}
                  >
                    <DropdownMenuSubTrigger
                      className="w-9 justify-center px-2"
                      aria-label={`Workspace actions for ${collection.name}`}
                    ></DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          setOpenWorkspaceActionId(undefined);
                          handleWorkspaceRename(summary);
                        }}
                      >
                        <Pencil className="h-4 w-4 mr-2" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={deleteDisabledReason !== undefined}
                        title={deleteDisabledReason}
                        aria-label={deleteDisabledReason ?? `Delete ${collection.name}`}
                        onSelect={() => setDeleteCandidate(summary)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </div>
              );
            })
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onNewWorkspace}>
            <Plus className="w-4 h-4 mr-2" />
            New Workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="text-sm font-medium text-background/80 drop-shadow-sm">/</span>

      {isEditingProject ? (
        <div className="flex min-w-0 items-center gap-1">
          <Input
            ref={projectInputRef}
            value={projectNameValue}
            onChange={(e) => setProjectNameValue(e.target.value)}
            onBlur={commitProjectRename}
            onKeyDown={handleProjectKeyDown}
            className="h-8 w-48 min-w-32 bg-background/90 backdrop-blur border-border text-sm"
            autoFocus
          />
          <button
            type="button"
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-background/80 backdrop-blur border border-border shadow-md hover:bg-background/90"
            onMouseDown={(e) => {
              e.preventDefault();
              commitProjectRename();
            }}
            aria-label="Save name"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-background/80 backdrop-blur border border-border shadow-md hover:bg-background/90"
            onMouseDown={(e) => {
              e.preventDefault();
              cancelProjectRename();
            }}
            aria-label="Cancel rename"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={startEditingProject}
          className="flex h-8 min-w-32 max-w-64 items-center gap-1.5 rounded-lg border border-border bg-background/80 px-3 text-sm font-medium shadow-md backdrop-blur hover:bg-background/90"
          aria-label="Rename project"
        >
          <span className="truncate">{projectName}</span>
          <Pencil className="w-3 h-3 shrink-0 opacity-60" />
        </button>
      )}

      <Dialog open={deleteCandidate !== undefined} onOpenChange={(open) => !open && setDeleteCandidate(undefined)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Workspace</DialogTitle>
            <DialogDescription>This workspace and its projects will disappear from normal lists.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="cancel" onClick={() => setDeleteCandidate(undefined)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmWorkspaceDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
