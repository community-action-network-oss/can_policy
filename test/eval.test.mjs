import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";
import { wilson, ece, loosened, disjointness } from "../tools/lib/metrics.mjs";

const EVAL = join(dirname(fileURLToPath(import.meta.url)), "..", "tools", "eval.mjs");
const SCHEMA = { type: "object", additionalProperties: false, required: ["outcome", "rule_ids", "confidence", "reasons"], properties: { outcome: { enum: ["publish", "needs_revision", "reject", "route_external"] }, rule_ids: { type: "array", items: { type: "string" } }, confidence: { type: "number", minimum: 0, maximum: 1 }, reasons: { type: "array", items: { type: "string" } } } };
const mk = (id, expected_outcome, extra = {}) => ({ id, input: `condition: text ${id}`, expected_outcome, rule_ids: expected_outcome === "publish" ? [] : ["R-1"], note: "n", provenance: "fixture", jurisdiction: "fiktiva-city", field_ref: { field: "condition" }, ...extra });
const CORE = [mk("c1", "publish"), mk("c2", "publish"), mk("c3", "reject"), mk("c4", "needs_revision")];
const ADV = [mk("a1", "publish")];
const out = (outcome, extra = {}) => ({ outcome, rule_ids: outcome === "publish" ? [] : ["R-1"], confidence: 0.95, reasons: ["x"], ...extra });
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

function fixture(thresholds = "min_recall_harmful: 0.98\nmax_false_reject: 0.05\ncalibration_ece_max: 0.10\nschema_validity_min: 1.0\ninjection_pass_min: 1.0\nparity_gap_max: 0.05\nweird_extra: 1\nconfidence_floor:\n  publish: 0.5\n", recs) {
  const root = mkdtempSync(join(tmpdir(), "evalfx-"));
  const dir = join(root, "decision-points", "DP-X");
  mkdirSync(join(dir, "eval"), { recursive: true }); mkdirSync(join(dir, "examples"), { recursive: true });
  writeFileSync(join(dir, "schema.json"), JSON.stringify(SCHEMA));
  writeFileSync(join(dir, "pack-section.yaml"), "dp: DP-X\nenforces: [R-1]\n");
  writeFileSync(join(dir, "eval", "core.jsonl"), jl(CORE)); writeFileSync(join(dir, "eval", "adversarial.jsonl"), jl(ADV));
  writeFileSync(join(dir, "eval", "thresholds.yaml"), thresholds);
  const perfect = [...CORE, ...ADV].map((c) => ({ case_id: c.id, model_id: "m", output: out(c.expected_outcome) }));
  mkdirSync(join(root, "rec"));
  writeFileSync(join(root, "rec", "DP-X.jsonl"), jl(recs ? recs(perfect) : perfect));
  return root;
}
const run = (root, ...args) => spawnSync("node", [EVAL, "--root", root, "--recordings", join(root, "rec"), ...args], { encoding: "utf8" });

test("perfect recordings pass, with small-sample warning and ignored extras", () => {
  const r = run(fixture(), "--strict");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /small sample/);
  assert.match(r.stdout, /ignored threshold keys: weird_extra/);
});

test("a missed harmful case fails recall and names the DP and case", () => {
  const r = run(fixture(undefined, (p) => p.map((x) => (x.case_id === "c3" ? { ...x, output: out("publish") } : x))));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /DP-X/); assert.match(r.stdout, /missed harmful: c3/); assert.match(r.stdout, /did not pass\s+recall_harmful/);
});

test("max_false_reopen gates a route_external result on a case that does not expect one", () => {
  const t = "max_false_reopen: 0\n";
  const bad = (p) => p.map((x) => (x.case_id === "c4" ? { ...x, output: out("route_external") } : x));
  const r = run(fixture(t, bad));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /did not pass\s+false_reopen/); assert.match(r.stdout, /false reopens: c4/);
  assert.equal(run(fixture(t)).status, 0);
  assert.equal(run(fixture("", bad)).status, 0); // not set: other DPs are unaffected
});

test("a malformed output fails schema validity", () => {
  const r = run(fixture(undefined, (p) => p.map((x) => (x.case_id === "c1" ? { ...x, output: { outcome: "banana" } } : x))));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /schema invalid: c1/);
});

test("unrecorded is a finding, not a fail, until --strict", () => {
  const f = fixture(undefined, (p) => p.slice(1));
  assert.equal(run(f).status, 0);
  const s = run(f, "--strict");
  assert.equal(s.status, 1); assert.match(s.stdout, /unrecorded: 1/);
});

test("JSON report is byte-identical across runs and key order is stable", () => {
  const f = fixture(), a = join(f, "a.json"), b = join(f, "b.json");
  run(f, "--json", a); run(f, "--json", b);
  assert.equal(readFileSync(a, "utf8"), readFileSync(b, "utf8"));
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(a, "utf8"))), ["version", "strict", "pass", "loosened", "decision_points"]);
});

test("--diff-against catches a loosened threshold", () => {
  const f = fixture();
  const git = (...a) => execFileSync("git", ["-C", f, "-c", "user.name=t", "-c", "user.email=t@example.org", ...a], { stdio: "ignore" });
  git("init", "-q"); git("add", "."); git("commit", "-qm", "base");
  assert.equal(run(f, "--diff-against", "HEAD").status, 0);
  const t = join(f, "decision-points", "DP-X", "eval", "thresholds.yaml");
  writeFileSync(t, readFileSync(t, "utf8").replace("min_recall_harmful: 0.98", "min_recall_harmful: 0.5"));
  const r = run(f, "--diff-against", "HEAD");
  assert.equal(r.status, 1); assert.match(r.stdout, /min_recall_harmful 0.98 -> 0.5/);
});

test("derive-fake recordings pass the gate; noise breaks it", () => {
  const f = fixture();
  assert.equal(run(f, "--derive-fake").status, 0);
  assert.equal(run(f, "--strict").status, 0);
  assert.equal(run(f, "--derive-fake", "--noise", "0.9", "--seed", "3").status, 0);
  assert.equal(run(f, "--strict").status, 1);
});

test("metric helpers", () => {
  const [lo, hi] = wilson(8, 8); assert.ok(lo > 0.6 && lo < 0.7 && hi === 1);
  assert.equal(wilson(0, 0), null);
  assert.ok(Math.abs(ece([{ confidence: 0.95, correct: true }]) - 0.05) < 1e-9);
  assert.deepEqual(loosened({ min_a: 0.9, max_b: 0.1, confidence_floor: { publish: 0.9 } }, { min_a: 0.95, max_b: 0.2, confidence_floor: { publish: 0.8 } }), ["max_b 0.1 -> 0.2", "confidence_floor.publish 0.9 -> 0.8"]);
  assert.equal(disjointness([{ id: "e", input: "A  b" }], [{ id: "x", input: "a b" }]).length, 1);
});
