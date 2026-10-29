import raw from "../../data/berlin-student.pack.json";
import type { Pack } from "./schema";
import { validatePack } from "./validate";

/**
 * Loads and validates the Berlin pack once. If the pack breaks a trust rule
 * (unknown source, uncited rule, cycle...) we fail loudly instead of serving it.
 */
function load(): Pack {
  const result = validatePack(raw);
  const errors = result.issues.filter((i) => i.severity === "error");
  if (!result.ok || !result.pack) {
    throw new Error(
      `Berlin data pack failed validation:\n${errors.map((e) => `  [${e.code}] ${e.path}: ${e.message}`).join("\n")}`,
    );
  }
  return result.pack;
}

export const berlinPack: Pack = load();
