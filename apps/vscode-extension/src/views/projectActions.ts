/** A command launcher shown in the Wendoo explorer view. */
export interface ProjectAction {
  /** Item label shown in the tree. */
  label: string;
  /** Command executed when the item is clicked. */
  commandId: string;
  /** Codicon id for the item icon. */
  icon: string;
}

/** The desktop explorer view's command launchers, in display order. */
export const PROJECT_ACTIONS: readonly ProjectAction[] = [
  { label: "Create new sensor", commandId: "wendoo.createSensor", icon: "eye" },
  { label: "Create new actuator", commandId: "wendoo.createActuator", icon: "zap" },
  { label: "Import project", commandId: "wendoo.importProject", icon: "cloud-download" },
  { label: "Open editor", commandId: "wendoo.openEditor", icon: "window" },
  { label: "Open settings", commandId: "wendoo.openSettings", icon: "settings-gear" },
];
