// List the legal stack for a jurisdiction: layer, corpus id, status, reviewed. Usage: node tools/list-stack.mjs nl-amsterdam
// A corpus applies when its jurisdiction is the id or its country prefix (nl-amsterdam -> nl-amsterdam, nl).
import { parse } from "yaml";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { legalDirs } from "./pack-hash.mjs";

export function listStack(root, jurisdiction) {
  const country = jurisdiction.split("-")[0];
  const corpora = legalDirs(root).map((d) => parse(readFileSync(join(root, d, "corpus.yaml"), "utf8")))
    .filter((c) => c.jurisdiction === jurisdiction || c.jurisdiction === country);
  return ["L1", "L2", "L3", "L4", "L5", "L6"].flatMap((layer) => {
    const rows = corpora.filter((c) => c.layer === layer).map((c) => ({ layer, id: c.id, status: c.status, reviewed: c.reviewed }));
    return rows.length ? rows : [{ layer, id: "-", status: "absent", reviewed: false }];
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const j = process.argv[2];
  if (!j) { console.error("usage: node tools/list-stack.mjs <jurisdiction>"); process.exit(2); }
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  for (const r of listStack(root, j)) console.log([r.layer, r.id, r.status, r.reviewed].join("\t"));
}
