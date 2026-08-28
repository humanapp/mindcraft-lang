import type { EditedBrainWorkspaces } from "@wendoo/assistant-panel";
import { AssistantSurface, brainPlacesOf, brainSurfaceOf, useAssistant } from "@wendoo/assistant-panel";
import { useEditedBrain, useOptionalBrainEditorConfig } from "@wendoo/ui";
import { useEffect, useMemo } from "react";

/** What the side region's tenant is given by the app that put it there. */
export interface AssistantSidePanelProps {
  /** Whether the editor's side region stands open. */
  isOpen: boolean;
  /** The entity's name to show while the editor stands no working copy of it yet. */
  fallbackName: string;
  /** The workspaces a turn's tool calls run against. */
  workspaces: EditedBrainWorkspaces;
  /**
   * How many times the person themselves opened the region. Each new count
   * lands the keyboard in the intent box. Absent while every open so far was
   * one the person did not ask for, restored from where the region stood
   * before, which lands the keyboard nowhere.
   */
  opensByPerson?: number | undefined;
}

/**
 * The conversation surface as this app mounts it: it stands the brain the
 * editor is editing as the one an assistant turn may reach, shows that brain's
 * conversation, and opens its session once the region is open.
 */
export function AssistantSidePanel({ isOpen, fallbackName, workspaces, opensByPerson }: AssistantSidePanelProps) {
  const edited = useEditedBrain();
  const editorConfig = useOptionalBrainEditorConfig();
  const { setActiveBrain, openSession } = useAssistant();
  const brainId = edited?.brainDef.id();
  const brainSurface = useMemo(() => brainSurfaceOf(editorConfig, edited?.brainDef.catalog()), [editorConfig, edited]);
  const brainPlaces = useMemo(() => brainPlacesOf(edited, workspaces), [edited, workspaces]);

  useEffect(() => {
    workspaces.setEditedBrain(edited);
    return () => workspaces.setEditedBrain(undefined);
  }, [edited, workspaces]);

  useEffect(() => {
    if (brainId !== undefined) setActiveBrain(brainId);
  }, [brainId, setActiveBrain]);

  useEffect(() => {
    if (isOpen && brainId !== undefined) openSession(brainId);
  }, [isOpen, brainId, openSession]);

  return (
    <AssistantSurface
      name={edited?.brainDef.name() ?? fallbackName}
      onLeaveIntent={edited?.takeKeyboard}
      opensByPerson={opensByPerson}
      brainSurface={brainSurface}
      brainPlaces={brainPlaces}
    />
  );
}
