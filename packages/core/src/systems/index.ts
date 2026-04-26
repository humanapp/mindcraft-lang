import type { Logger } from "../platform/logger";
import { IConnection, type ISignal } from "./signal";

export type { IConnection, ISignal } from "./signal";

/** Identifies a player connected to the host. */
export interface PlayerHandle {
  id: number;
  name: string;
}

/** Host-provided service for enumerating players and observing connect/disconnect events. */
export interface IPlayersService {
  playerAdded: ISignal<[player: PlayerHandle]>;
  playerRemoving: ISignal<[player: PlayerHandle]>;
  players(): PlayerHandle[];
}

/** Host-provided service for observing the per-frame heartbeat and identifying server/client context. */
export interface IRunService {
  isServer(): boolean;
  isClient(): boolean;
  heartbeat: ISignal<[dt: number]>;
}

/** Host-provided HTTP utilities (GUID generation, JSON encode/decode). */
export interface IHttpService {
  generateGUID(): string;
  jsonEncode(value: unknown): string;
  jsonDecode<T = unknown>(json: string): T;
}

/** Host-provided translator service. Resolves message keys (or source strings) to localized text. */
export interface ITranslatorService {
  tr(keyOrSource: string, args?: Record<string, unknown>): string;
}

/** Bag of host services injected by the embedding application. */
export interface IGameServices {
  players: IPlayersService;
  runService: IRunService;
  httpService: IHttpService;
  i18n: ITranslatorService;
  logger: Logger;
}

let gameServices: IGameServices | undefined;

/** Return the registered {@link IGameServices}. Throws when services have not been set. */
export function services(): IGameServices {
  if (gameServices === undefined) {
    throw { message: "Services have not been set" };
  }
  return gameServices;
}

/** Install the host-provided service implementations. Must be called before {@link services} is invoked. */
export function setServices(_services: IGameServices): void {
  gameServices = _services;
}
