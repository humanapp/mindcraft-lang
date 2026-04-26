/** Identifies whether the current execution context is the server or the client. */
export interface IEnvironment {
  readonly isServer: boolean;
  readonly isClient: boolean;
}
