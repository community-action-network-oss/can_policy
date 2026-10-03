import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintCandidates } from "../tools/lint-candidates.mjs";

const REPO = new URL("..", import.meta.url).pathname;
const ROW = readFileSync(join(REPO, "simulation/personas/adv-doxx/attacks.jsonl"), "utf8").split("\n")[0];
const row = JSON.parse(ROW);
const BASE = {
  id: "cand-001", dp: "DP-PRIVACY", input: "condition: [redacted name] blocks the bins", expected_outcome: "reject", rule_ids: ["PRIV-GATE-1"],
  field_ref: { field: "condition" }, jurisdiction: "fiktiva-city", language: "en", provenance: "simulation", run_id: "run-1",
  persona_id: "adv-doxx", seed_id: "seed-1-amsterdam-safety", attack_ref: { persona_id: "adv-doxx", row_id: row.id },
  miss_kind: "leak", observed_outcome: "publish", status: "candidate", recording_kind: "fake", satisfies_graduation: false,
};
// Temp tree: the real DPs, personas and seeds, plus the given candidate and extra DP rows.
function run(mutate = () => {}, extra = () => {}) {
  const d = mkdtempSync(join(tmpdir(), "can-cand-"));
  for (const p of ["decision-points", "simulation"]) cpSync(join(REPO, p), join(d, p), { recursive: true });
  const c = structuredClone(BASE); mutate(c);
  mkdirSync(join(d, "simulation/candidates", c.run_id ?? "run-1"), { recursive: true });
  writeFileSync(join(d, "simulation/candidates", c.run_id ?? "run-1", `${c.id}.json`), JSON.stringify(c));
  extra(d);
  return lintCandidates(d);
}
const has = (errs, re) => assert.ok(errs.some((e) => re.test(e)), errs.join("\n") || "no errors");

test("shipped tree is clean", () => assert.deepEqual(lintCandidates(REPO), []));
test("valid candidate passes", () => assert.deepEqual(run(), []));
test("schema defects fail", () => {
  has(run((c) => { c.provenance = "fixture"; }), /candidate schema/);
  has(run((c) => { c.miss_kind = "bad"; }), /candidate schema/);
  has(run((c) => { delete c.run_id; }), /candidate schema/);
  has(run((c) => { c.extra = 1; }), /candidate schema/);
  has(run((c) => { c.jurisdiction = "amsterdam"; }), /candidate schema/);
});
test("confirmed needs a label task, unconfirmed must not have one", () => {
  has(run((c) => { c.status = "confirmed"; }), /candidate schema/);
  has(run((c) => { c.confirmed_by_label_task = "lt-1"; }), /candidate schema/);
  assert.deepEqual(run((c) => { c.status = "confirmed"; c.confirmed_by_label_task = "lt-1"; }), []);
});
test("fake recordings can never satisfy graduation", () => has(run((c) => { c.satisfies_graduation = true; }), /candidate schema/));
test("personal data is rejected", () => {
  for (const t of ["mail a@b.test", "mail a＠b", "see https://x.test", "see www.x.test", "call 0612345678", "x http y"]) has(run((c) => { c.input = t; }), /personal-data/);
  has(run((c) => { c.observed_outcome = "a@b"; }), /personal-data/);
});
test("attack data must be referenced, not copied", () => {
  has(run((c) => { c.input = `condition: ${row.payload}`; }), /copies planted attack data/);
  has(run((c) => { c.input = `see ${row.planted_canaries[0]}`; }), /copies planted attack data/);
  has(run((c) => { delete c.attack_ref; }), /needs attack_ref/);
  has(run((c) => { c.attack_ref.row_id = "nope"; }), /does not exist/);
});
test("closed sets: dp, rule ids, outcome, seed, id, run dir", () => {
  has(run((c) => { c.dp = "DP-NOPE"; }), /does not exist/);
  has(run((c) => { c.rule_ids = ["NAME-1"]; }), /not in DP-PRIVACY's enforces/);
  has(run((c) => { c.expected_outcome = "approve"; }), /outcomes/);
  has(run((c) => { c.seed_id = "seed-9-nope"; }), /seed .* does not exist/);
  has(run((c) => { c.persona_id = "sub-nope"; }), /persona .* does not exist/);
  has(run(() => {}, (d) => writeFileSync(join(d, "simulation/candidates/run-1/cand-002.json"), JSON.stringify({ ...BASE, id: "cand-001" }))), /file name must be|duplicate/);
});
test("duplicate ids across runs fail", () => {
  has(run(() => {}, (d) => { mkdirSync(join(d, "simulation/candidates/run-2")); writeFileSync(join(d, "simulation/candidates/run-2/cand-001.json"), JSON.stringify({ ...BASE, run_id: "run-2" })); }), /duplicate id/);
});
test("simulation rows in DP sets must trace to a confirmed candidate", () => {
  const add = (d) => writeFileSync(join(d, "decision-points/DP-PRIVACY/eval/regression.jsonl"), JSON.stringify({ id: "cand-001", input: "x", expected_outcome: "reject", rule_ids: [], note: "n", provenance: "simulation", jurisdiction: "fiktiva-city" }) + "\n");
  has(run(() => {}, add), /not a confirmed candidate/);
  assert.deepEqual(run((c) => { c.status = "confirmed"; c.confirmed_by_label_task = "lt-1"; }, add), []);
});
