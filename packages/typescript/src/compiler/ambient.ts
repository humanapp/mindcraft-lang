export const AMBIENT_MINDCRAFT_DTS = `
declare module "mindcraft" {
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
    type: string;
    default?: unknown;
  }

  export interface SensorConfig {
    name: string;
    output: string;
    params: Record<string, ParamDef>;
    exec(ctx: Context, params: Record<string, unknown>): unknown;
  }

  export interface ActuatorConfig {
    name: string;
    params: Record<string, ParamDef>;
    exec(ctx: Context, params: Record<string, unknown>): void | Promise<void>;
  }

  export function Sensor(config: SensorConfig): unknown;
  export function Actuator(config: ActuatorConfig): unknown;
}
`;
