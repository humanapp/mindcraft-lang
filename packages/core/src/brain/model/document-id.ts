import { StringUtils as SU } from "../../platform/string";
import type { IRngServices } from "../../runtime/services";

// Length of a minted document id, in characters.
const kDocumentIdLength = 16;

/**
 * Mints the id a brain, page, or rule is addressed by, drawing every character
 * from `rng`.
 *
 * @param rng - The environment's random stream, `services.app.rng`.
 */
export function mintDocumentId(rng: IRngServices): string {
  return SU.mkid(kDocumentIdLength, () => rng.next());
}
