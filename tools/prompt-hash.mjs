// prompt_hash: sha256 (hex) of the DP prompt template above the data block, CRLF normalised to LF,
// with {{RULES}} and {{SHOTS}} left as literal markers. This is the definition plan 09 uses in the server.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const DATA_OPEN = "<<<DATA";
export const DATA_CLOSE = "DATA>>>";

export function promptHash(text) {
  const t = text.replaceAll("\r\n", "\n");
  const i = t.indexOf(DATA_OPEN);
  if (i < 0) throw new Error(`prompt has no ${DATA_OPEN} marker`);
  return createHash("sha256").update(t.slice(0, i)).digest("hex");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dp = process.argv[2];
  if (!dp) { console.error("usage: node tools/prompt-hash.mjs DP-NAME"); process.exit(2); }
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  console.log(promptHash(readFileSync(join(root, "decision-points", dp, "prompt.md"), "utf8")));
}
