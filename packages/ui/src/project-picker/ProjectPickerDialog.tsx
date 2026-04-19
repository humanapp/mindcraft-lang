import { Plus, Trash2 } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

export interface ProjectPickerItem {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  updatedAt: number;
}

export interface ProjectPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectPickerItem[];
  activeProjectId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function ProjectPickerDialog({
  open,
  onOpenChange,
  projects,
  activeProjectId,
  onSelect,
  onDelete,
  onCreate,
}: ProjectPickerDialogProps) {
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);

  const sorted = React.useMemo(() => [...projects].sort((a, b) => b.updatedAt - a.updatedAt), [projects]);

  const handleSelect = (id: string) => {
    onSelect(id);
    onOpenChange(false);
  };

  const handleDelete = (id: string) => {
    onDelete(id);
    setConfirmDeleteId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Projects</DialogTitle>
          <DialogDescription>Select a project to open, or create a new one.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {sorted.map((project) => (
            <button
              key={project.id}
              type="button"
              aria-current={project.id === activeProjectId ? true : undefined}
              className={cn(
                "group flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent",
                project.id === activeProjectId && "bg-accent/60"
              )}
              onClick={() => handleSelect(project.id)}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{project.title}</span>
                  {project.id === activeProjectId && (
                    <span
                      aria-hidden="true"
                      className="shrink-0 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary"
                    >
                      active
                    </span>
                  )}
                </div>
                {project.description && <p className="truncate text-xs text-muted-foreground">{project.description}</p>}
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{formatRelativeTime(project.updatedAt)}</span>
                  {project.tags?.map((tag) => (
                    <span key={tag} className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              {project.id !== activeProjectId && (
                <span
                  className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  role="none"
                >
                  {confirmDeleteId === project.id ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="destructive"
                        size="sm"
                        aria-label={`Confirm delete ${project.title}`}
                        className="h-6 px-2 text-xs"
                        onClick={() => handleDelete(project.id)}
                      >
                        Yes
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Cancel deleting ${project.title}`}
                        className="h-6 px-2 text-xs"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${project.title}`}
                      className="h-6 w-6"
                      onClick={() => setConfirmDeleteId(project.id)}
                    >
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </span>
              )}
            </button>
          ))}
        </div>
        <Button variant="outline" className="w-full" onClick={onCreate}>
          <Plus aria-hidden="true" className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </DialogContent>
    </Dialog>
  );
}
