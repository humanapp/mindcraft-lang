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

interface ProjectCardProps {
  project: ProjectPickerItem;
  isActive: boolean;
  isConfirmingDelete: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onStartDelete: () => void;
  onCancelDelete: () => void;
}

function ProjectCard({
  project,
  isActive,
  isConfirmingDelete,
  onSelect,
  onDelete,
  onStartDelete,
  onCancelDelete,
}: ProjectCardProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const openRef = React.useRef<HTMLButtonElement>(null);
  const wasConfirmingRef = React.useRef(false);
  const descId = `project-desc-${project.id}`;

  React.useEffect(() => {
    if (isConfirmingDelete) {
      wasConfirmingRef.current = true;
      cancelRef.current?.focus();
    } else if (wasConfirmingRef.current) {
      wasConfirmingRef.current = false;
      openRef.current?.focus();
    }
  }, [isConfirmingDelete]);

  const descriptionParts: string[] = [];
  if (project.description) descriptionParts.push(project.description);
  descriptionParts.push(`Last modified ${formatRelativeTime(project.updatedAt)}.`);
  if (project.tags?.length) descriptionParts.push(`Tags: ${project.tags.join(", ")}.`);
  if (isActive) descriptionParts.push("Currently active.");
  if (!isActive) descriptionParts.push("Press Delete to delete.");

  return (
    <li
      className={cn(
        "group relative list-none overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm transition-all",
        isActive ? "ring-2 ring-primary" : "sm:hover:scale-[1.02] sm:hover:shadow-md"
      )}
    >
      <span id={descId} className="sr-only">
        {descriptionParts.join(" ")}
      </span>

      <div aria-hidden="true">
        <div className={cn("h-24 bg-linear-to-br", cardGradient(project.id))} />
        <div className="p-3">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{project.title}</span>
            {isActive && (
              <span className="shrink-0 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">active</span>
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
      </div>

      {!isConfirmingDelete && (
        <button
          ref={openRef}
          type="button"
          className="absolute inset-0 z-0 cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          aria-label={isActive ? `${project.title} (currently active)` : `Open ${project.title}`}
          aria-describedby={descId}
          aria-current={isActive ? true : undefined}
          onClick={() => onSelect(project.id)}
          onKeyDown={(e) => {
            if (!isActive && (e.key === "Delete" || e.key === "Backspace")) {
              e.preventDefault();
              onStartDelete();
            }
          }}
        />
      )}

      {!isActive && !isConfirmingDelete && (
        <button
          tabIndex={-1}
          type="button"
          className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded bg-black/30 text-white outline-none transition-opacity hover:bg-black/50 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-inset sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
          aria-label={`Delete ${project.title}`}
          onClick={() => onStartDelete()}
        >
          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      )}

      {!isActive && isConfirmingDelete && (
        // biome-ignore lint/a11y/useSemanticElements: fieldset cannot be positioned absolute inside li
        <div
          role="group"
          aria-label={`Confirm deletion of ${project.title}`}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-background/95 p-4"
        >
          <p className="text-center text-sm font-medium">Delete &ldquo;{project.title}&rdquo;?</p>
          <p className="text-center text-xs text-muted-foreground">This cannot be undone.</p>
          <div className="flex gap-2">
            <Button
              ref={cancelRef}
              variant="ghost"
              size="sm"
              aria-label={`Cancel deleting ${project.title}`}
              onClick={onCancelDelete}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              aria-label={`Confirm delete ${project.title}`}
              onClick={() => onDelete(project.id)}
            >
              Delete
            </Button>
          </div>
        </div>
      )}
    </li>
  );
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
  const [confirmingDeleteId, setConfirmingDeleteId] = React.useState<string | null>(null);
  const sorted = React.useMemo(() => [...projects].sort((a, b) => b.updatedAt - a.updatedAt), [projects]);

  const handleSelect = (id: string) => {
    onSelect(id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="left-0 top-0 translate-x-0 translate-y-0 flex h-dvh max-w-full flex-col gap-0 overflow-hidden p-0 rounded-none sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:h-170 sm:max-w-240 sm:w-[calc(100vw-2rem)] sm:rounded-lg"
        onEscapeKeyDown={(e) => {
          if (confirmingDeleteId !== null) {
            e.preventDefault();
            setConfirmingDeleteId(null);
          }
        }}
      >
        <DialogHeader className="flex-row items-center justify-between space-y-0 border-b px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <DialogTitle>Projects</DialogTitle>
            <DialogDescription className="mt-0.5">Select a project to open, or create a new one.</DialogDescription>
          </div>
          <Button variant="outline" onClick={onCreate} className="shrink-0">
            <Plus aria-hidden="true" className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4" aria-label="Projects">
            {sorted.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                isActive={project.id === activeProjectId}
                isConfirmingDelete={confirmingDeleteId === project.id}
                onSelect={handleSelect}
                onDelete={onDelete}
                onStartDelete={() => setConfirmingDeleteId(project.id)}
                onCancelDelete={() => setConfirmingDeleteId(null)}
              />
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
