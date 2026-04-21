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

const CARD_GRADIENTS = [
  "from-blue-500 to-indigo-600",
  "from-purple-500 to-pink-600",
  "from-emerald-500 to-teal-600",
  "from-orange-500 to-red-600",
  "from-yellow-400 to-orange-500",
  "from-sky-500 to-blue-600",
  "from-rose-500 to-pink-600",
  "from-violet-500 to-purple-600",
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return h;
}

function cardGradient(id: string): string {
  return CARD_GRADIENTS[hashId(id) % CARD_GRADIENTS.length];
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
      <DialogContent className="flex h-170 w-240 max-w-240 flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="flex-row items-center justify-between space-y-0 border-b px-6 py-4">
          <div>
            <DialogTitle>Projects</DialogTitle>
            <DialogDescription className="mt-0.5">Select a project to open, or create a new one.</DialogDescription>
          </div>
          <Button variant="outline" onClick={onCreate} className="shrink-0">
            <Plus aria-hidden="true" className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-4 gap-4">
            {sorted.map((project) => {
              const isActive = project.id === activeProjectId;
              const isConfirmingDelete = confirmDeleteId === project.id;

              return (
                // biome-ignore lint/a11y/useSemanticElements: button cannot nest interactive children
                <div
                  key={project.id}
                  role="button"
                  tabIndex={0}
                  aria-current={isActive ? true : undefined}
                  className={cn(
                    "group relative cursor-pointer overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm transition-all hover:shadow-md",
                    isActive ? "ring-2 ring-primary" : "hover:scale-[1.02]"
                  )}
                  onClick={() => {
                    if (!isConfirmingDelete) handleSelect(project.id);
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && !isConfirmingDelete) {
                      e.preventDefault();
                      handleSelect(project.id);
                    }
                  }}
                >
                  <div className={cn("h-24 bg-linear-to-br", cardGradient(project.id))} />
                  <div className="p-3">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{project.title}</span>
                      {isActive && (
                        <span
                          aria-hidden="true"
                          className="shrink-0 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary"
                        >
                          active
                        </span>
                      )}
                    </div>
                    {project.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{project.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <span className="text-[10px] text-muted-foreground">{formatRelativeTime(project.updatedAt)}</span>
                      {project.tags?.map((tag) => (
                        <span key={tag} className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  {!isActive && isConfirmingDelete && (
                    <div
                      className="flex items-center gap-1 border-t px-3 pb-3 pt-2"
                      role="none"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <span className="mr-auto text-xs text-muted-foreground">Delete?</span>
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
                  )}
                  {!isActive && !isConfirmingDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${project.title}`}
                      className="absolute right-2 top-2 h-7 w-7 bg-black/30 text-white opacity-0 transition-opacity hover:bg-black/50 hover:text-white group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(project.id);
                      }}
                    >
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
