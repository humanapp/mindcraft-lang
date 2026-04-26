/** Handle to a signal subscription; call `disconnect` to remove the listener. */
export interface IConnection {
  disconnect(): void;
}

/** Generic broadcast signal. Listeners receive a tuple of arguments. */
export interface ISignal<TArgs extends unknown[]> {
  connect(handler: (...args: TArgs) => void): IConnection;
}
