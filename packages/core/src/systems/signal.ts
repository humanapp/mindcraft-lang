export interface IConnection {
  disconnect(): void;
}

export interface ISignal<TArgs extends unknown[]> {
  connect(handler: (...args: TArgs) => void): IConnection;
}
