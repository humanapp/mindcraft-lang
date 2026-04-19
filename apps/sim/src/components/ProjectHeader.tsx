import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input } from "@mindcraft-lang/ui";
import { Check, FolderOpen, Menu, Pencil, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSimEnvironment } from "@/contexts/sim-environment";

interface ProjectHeaderProps {
  projectName: string;
  onBrowseProjects: () => void;
  onNewProject: () => void;
}

export function ProjectHeader({ projectName, onBrowseProjects, onNewProject }: ProjectHeaderProps) {
  const store = useSimEnvironment();
  const [isEditing, setIsEditing] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.select();
    }
  }, [isEditing]);

  const startEditing = useCallback(() => {
    setNameValue(projectName);
    setIsEditing(true);
  }, [projectName]);

  const commitRename = useCallback(() => {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== projectName) {
      store.updateProjectMetadata({ name: trimmed });
    }
    setIsEditing(false);
  }, [nameValue, projectName, store]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        commitRename();
      } else if (e.key === "Escape") {
        cancelEditing();
      }
    },
    [commitRename, cancelEditing]
  );

  return (
    <div className="absolute top-3 left-3 z-40 flex items-center gap-1">
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
          <DropdownMenuItem onSelect={onBrowseProjects}>
            <FolderOpen className="w-4 h-4 mr-2" />
            Browse Projects
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {isEditing ? (
        <div className="flex items-center gap-1">
          <Input
            ref={inputRef}
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            className="h-8 w-48 bg-background/90 backdrop-blur border-border text-sm"
            autoFocus
          />
          <button
            type="button"
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-background/80 backdrop-blur border border-border shadow-md hover:bg-background/90"
            onMouseDown={(e) => {
              e.preventDefault();
              commitRename();
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
              cancelEditing();
            }}
            aria-label="Cancel rename"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={startEditing}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-background/80 backdrop-blur border border-border shadow-md hover:bg-background/90 text-sm font-medium truncate max-w-50"
          aria-label="Rename project"
        >
          <span className="truncate">{projectName}</span>
          <Pencil className="w-3 h-3 shrink-0 opacity-60" />
        </button>
      )}
    </div>
  );
}
