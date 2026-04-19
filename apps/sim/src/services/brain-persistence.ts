import { BrainDef, type MindcraftEnvironment } from "@mindcraft-lang/core/app";

function normalizeBrainDef(brainDef: unknown): BrainDef {
  if (!(brainDef instanceof BrainDef)) {
    throw new Error("Expected BrainDef from mindcraft environment");
  }

  if (brainDef.pages().size() === 0) {
    brainDef.appendNewPage();
  }

  return brainDef;
}

export function deserializeBrainFromArrayBuffer(env: MindcraftEnvironment, buffer: ArrayBuffer): BrainDef | undefined {
  try {
    const text = new TextDecoder().decode(new Uint8Array(buffer));
    const brainDef = normalizeBrainDef(env.deserializeBrainJsonFromPlain(JSON.parse(text) as unknown));
    return brainDef;
  } catch (err) {
    console.error("Failed to deserialize brain from ArrayBuffer:", err);
    return undefined;
  }
}
