import { Dict } from "@mindcraft-lang/core";
import type { BrainTileKind } from "@mindcraft-lang/core/brain";
import type { TileColorDef } from "./types";

export const tileColorMap = new Dict<BrainTileKind, TileColorDef>([
  ["operator", { when: "#AA94EB", do: "#93A6EB" }],
  ["controlFlow", { when: "#AA94EB", do: "#93A6EB" }],
  ["variable", { when: "#AA94EB", do: "#93A6EB" }],
  ["literal", { when: "#AA94EB", do: "#93A6EB" }],
  ["sensor", { when: "#AA94EB", do: "#93A6EB" }],
  ["actuator", { when: "#AA94EB", do: "#93A6EB" }],
  ["parameter", { when: "#AA94EB", do: "#93A6EB" }],
  ["modifier", { when: "#AA94EB", do: "#93A6EB" }],
  ["factory", { when: "#AA94EB", do: "#93A6EB" }],
  ["accessor", { when: "#AA94EB", do: "#93A6EB" }],
  ["page", { when: "#AA94EB", do: "#93A6EB" }],
  ["missing", { when: "#E57373", do: "#E57373" }],
]);
