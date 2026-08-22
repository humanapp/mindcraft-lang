/** A starter file for a new user tile: the folder/file base name and the file's content. */
export interface TileScaffold {
  /** Base name of the folder and `.ts` file created for the tile. */
  baseName: string;
  /** Full content of the created source file. */
  content: string;
}

/** Starter scaffold for a new sensor tile. */
export const SENSOR_SCAFFOLD: TileScaffold = {
  baseName: "my-sensor",
  content: `import { Sensor } from "wendoo";

export default Sensor({
  name: "my sensor",
  // icon: "./my-sensor.svg",
  // docs: "./my-sensor.md",
  onExecute(ctx, params): boolean {
    return false;
  },
});
`,
};

/** Starter scaffold for a new actuator tile. */
export const ACTUATOR_SCAFFOLD: TileScaffold = {
  baseName: "my-actuator",
  content: `import { Actuator } from "wendoo";

export default Actuator({
  name: "my actuator",
  // icon: "./my-actuator.svg",
  // docs: "./my-actuator.md",
  onExecute(ctx, params) {
  },
});
`,
};

/**
 * The first folder name derived from `baseName` that is absent from
 * `existing`: the base name itself, then `<baseName>-2`, `<baseName>-3`, and
 * so on.
 */
export function findUniqueFolderName(baseName: string, existing: ReadonlySet<string>): string {
  if (!existing.has(baseName)) return baseName;

  for (let i = 2; ; i++) {
    const candidate = `${baseName}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
}
