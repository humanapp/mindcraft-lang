/** A command launcher shown in the Mindcraft explorer view. */
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
  { label: "Create new sensor", commandId: "mindcraft.createSensor", icon: "eye" },
  { label: "Create new actuator", commandId: "mindcraft.createActuator", icon: "zap" },
  { label: "Open editor", commandId: "mindcraft.openEditor", icon: "window" },
  { label: "Open settings", commandId: "mindcraft.openSettings", icon: "settings-gear" },
];
