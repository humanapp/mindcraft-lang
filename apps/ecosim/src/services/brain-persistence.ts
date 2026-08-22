import { BrainDef, type WendooEnvironment } from "@wendoo/core/app";

function normalizeBrainDef(brainDef: unknown): BrainDef {
  if (!(brainDef instanceof BrainDef)) {
    throw new Error("Expected BrainDef from wendoo environment");
  }

  if (brainDef.pages().size() === 0) {
    brainDef.appendNewPage();
  }

  return brainDef;
}

export function deserializeBrainFromArrayBuffer(
  env: WendooEnvironment,
  buffer: ArrayBuffer,
  projectNamespace: string
): BrainDef | undefined {
  try {
    const text = new TextDecoder().decode(new Uint8Array(buffer));
    const brainDef = normalizeBrainDef(
      env.deserializeBrainJsonFromPlain(JSON.parse(text) as unknown, projectNamespace)
    );
    return brainDef;
  } catch (err) {
    console.error("Failed to deserialize brain from ArrayBuffer:", err);
    return undefined;
  }
}
