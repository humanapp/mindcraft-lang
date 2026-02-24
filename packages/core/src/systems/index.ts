import type { Logger } from "../platform/logger";
import { IConnection, type ISignal } from "./signal";

export type { IConnection, ISignal } from "./signal";

export interface PlayerHandle {
  id: number;
  name: string;
}

export interface IPlayersService {
  playerAdded: ISignal<[player: PlayerHandle]>;
  playerRemoving: ISignal<[player: PlayerHandle]>;
  players(): PlayerHandle[];
}

export interface IRunService {
  isServer(): boolean;
  isClient(): boolean;
  heartbeat: ISignal<[dt: number]>;
}

export interface IHttpService {
  generateGUID(): string;
  jsonEncode(value: unknown): string;
  jsonDecode<T = unknown>(json: string): T;
}

export interface ITranslatorService {
  tr(keyOrSource: string, args?: Record<string, unknown>): string;
}

export interface IGameServices {
  players: IPlayersService;
  runService: IRunService;
  httpService: IHttpService;
  i18n: ITranslatorService;
  logger: Logger;
}

let gameServices: IGameServices | undefined;

export function services(): IGameServices {
  if (gameServices === undefined) {
    throw { message: "Services have not been set" };
  }
  return gameServices;
}

export function setServices(_services: IGameServices): void {
  gameServices = _services;
}
