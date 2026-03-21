const AMBIENT_HEADER = `
interface Promise<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | undefined | null
  ): Promise<TResult>;
}

declare var Promise: {
  new <T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void) => void): Promise<T>;
};
`;

const AMBIENT_MODULE_START = `
declare module "mindcraft" {
  interface MindcraftTypeMap {
    boolean: boolean;
    number: number;
    string: string;
`;

const AMBIENT_MODULE_END = `
  }

  type MindcraftType = keyof MindcraftTypeMap;

  export interface Context {
    time: number;
    dt: number;
    self: {
      position: { x: number; y: number };
      getVariable(name: string): unknown;
      setVariable(name: string, value: unknown): void;
    };
    engine: {
      queryNearby(position: { x: number; y: number }, range: number): unknown[];
      moveAwayFrom(
        actor: unknown,
        position: { x: number; y: number },
        speed: number,
      ): Promise<void>;
    };
  }

  export interface ParamDef {
    type: MindcraftType;
    default?: unknown;
    anonymous?: boolean;
  }

  export interface SensorConfig {
    name: string;
    output: MindcraftType;
    params?: Record<string, ParamDef>;
    onExecute(ctx: Context, params: Record<string, unknown>): unknown;
    onPageEntered?(ctx: Context): void;
  }

  export interface ActuatorConfig {
    name: string;
    params?: Record<string, ParamDef>;
    onExecute(ctx: Context, params: Record<string, unknown>): void | Promise<void>;
    onPageEntered?(ctx: Context): void;
  }

  export function Sensor(config: SensorConfig): unknown;
  export function Actuator(config: ActuatorConfig): unknown;
}
`;

export function buildAmbientSource(appTypeEntries?: string[]): string {
  let typeMapExtras = "";
  if (appTypeEntries) {
    for (const entry of appTypeEntries) {
      typeMapExtras += `    ${entry}\n`;
    }
  }
  return AMBIENT_HEADER + AMBIENT_MODULE_START + typeMapExtras + AMBIENT_MODULE_END;
}

export const AMBIENT_MINDCRAFT_DTS = buildAmbientSource();
