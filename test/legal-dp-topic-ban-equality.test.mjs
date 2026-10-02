import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The schema cannot express article_id === topic_ban_ref; check it over every case and recording.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const jl = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
for (const dp of ["DP-LEGALITY", "DP-ELIGIBILITY", "DP-LEGAL"]) {
  const dir = join(ROOT, "decision-points", dp);
  const outs = [
    ...JSON.parse(readFileSync(join(dir, "examples", "cases.json"), "utf8")).map((c) => [c.id, c.expected]),
    ...["core", "adversarial"].flatMap((s) => jl(join(dir, "eval", `${s}.jsonl`)).map((c) => [c.id, c.expected])),
    ...jl(join(ROOT, "test/fixtures/eval/recordings", `${dp}.jsonl`)).map((r) => [r.case_id, r.output]),
  ];
  test(`${dp}: topic_ban_ref equals article_id on a constrains finding`, () => {
    for (const [id, o] of outs) for (const x of o?.legal_findings ?? []) {
      if (x.topic_ban_ref === undefined) continue;
      assert.equal(x.article_id, x.topic_ban_ref, id);
      assert.equal(x.finding, "constrains", id);
    }
  });
}
