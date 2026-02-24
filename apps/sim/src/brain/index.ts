import * as fns from "./fns";
import * as tiles from "./tiles";
import { registerTypes } from "./type-system";

export function registerBrainComponents() {
  registerTypes();
  fns.registerFns();
  tiles.registerTiles();
}
