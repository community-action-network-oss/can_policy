import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import { classify, buildReport } from "../tools/lib/replay-report.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FX = join(ROOT, "test", "fixtures", "replay");
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
const rd = (f) => readFileSync(join(FX, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

function run(decisions, heads, extra = []) {
  const d = mkdtempSync(join(tmpdir(), "replay-"));
  writeFileSync(join(d, "d.jsonl"), jl(decisions)); writeFileSync(join(d, "h.jsonl"), jl(heads));
  const args = ["--decisions", join(d, "d.jsonl"), "--head-recordings", join(d, "h.jsonl"), "--json", join(d, "r.json"), ...extra];
  const p = spawnSync(process.execPath, [join(ROOT, "tools", "replay.mjs"), ...args], { encoding: "utf8" });
  return { ...p, report: p.status === 2 ? null : JSON.parse(readFileSync(join(d, "r.json"), "utf8")), dir: d };
}
const withHead = (id, output) => (h) => (h.case_id === id ? { ...h, output: { ...h.output, ...output } } : h);

test("fixture: 60 decisions, 4 DPs, 2 jurisdictions, strata, no flips gives ok", () => {
  const d = rd("decisions.jsonl");
  assert.equal(d.length, 60);
  assert.equal(new Set(d.map((x) => x.dp)).size, 4);
  assert.equal(new Set(d.map((x) => x.jurisdiction)).size, 2);
  assert.ok(["appealed", "near_threshold"].every((s) => d.some((x) => x.stratum === s)));
  const r = run(d, rd("head.jsonl"));
  assert.equal(r.status, 0);
  assert.equal(r.report.verdict, "ok");
  assert.equal(r.report.totals.flips, 0);
});

test("report conforms to the schema and reruns are byte identical", () => {
  const d = rd("decisions.jsonl"), h = rd("head.jsonl").map(withHead("rp-001", { outcome: "needs_revision", rule_ids: ["TONE-1"] }));
  const a = run(d, h, ["--bump", "major"]), b = run(d, h, ["--bump", "major"]);
  const v = new Ajv2020({ strict: false }).compile(JSON.parse(readFileSync(join(ROOT, "schemas", "replay-report.schema.json"), "utf8")));
  assert.ok(v(a.report), JSON.stringify(v.errors));
  assert.equal(readFileSync(join(a.dir, "r.json"), "utf8"), readFileSync(join(b.dir, "r.json"), "utf8"));
});

test("an unintended privacy-tier flip blocks with exit 1", () => {
  const d = rd("decisions.jsonl"); // rp-017 is DP-PRIVACY, needs_revision with PRIV-GATE-1
  const id = d.find((x) => x.dp === "DP-PRIVACY" && x.outcome === "needs_revision").decision_id;
  const r = run(d, rd("head.jsonl").map(withHead(id, { outcome: "publish", rule_ids: [] })), ["--bump", "major"]);
  assert.equal(r.status, 1);
  assert.equal(r.report.verdict, "blocked");
  assert.match(r.report.blockers[0], /protected tier/);
  assert.equal(r.report.totals.protected_flips, 1);
});

test("an expected looser flip on a protected rule still blocks, an expected stricter one does not", () => {
  const d = rd("decisions.jsonl");
  const id = d.find((x) => x.dp === "DP-CRISIS" && x.outcome === "publish").decision_id;
  const m = join(mkdtempSync(join(tmpdir(), "mot-")), "m.txt"); writeFileSync(m, id + "\n");
  const stricter = run(d, rd("head.jsonl").map(withHead(id, { outcome: "hold", rule_ids: ["CRISIS-STATIC-1"] })), ["--motivating", m, "--bump", "major"]);
  assert.equal(stricter.status, 0);
  assert.equal(stricter.report.totals.expected, 1);
  const bad = d.find((x) => x.dp === "DP-CRISIS" && x.outcome === "hold").decision_id;
  const m2 = join(mkdtempSync(join(tmpdir(), "mot-")), "m.txt"); writeFileSync(m2, bad + "\n");
  const looser = run(d, rd("head.jsonl").map(withHead(bad, { outcome: "publish", rule_ids: [] })), ["--motivating", m2, "--bump", "major"]);
  assert.equal(looser.status, 1);
});

test("an unintended flip outside protected tiers needs review but does not block on a major bump", () => {
  const d = rd("decisions.jsonl");
  const id = d.find((x) => x.dp === "DP-TONE" && x.outcome === "publish").decision_id;
  const r = run(d, rd("head.jsonl").map(withHead(id, { outcome: "needs_revision", rule_ids: ["TONE-1"] })), ["--bump", "major"]);
  assert.equal(r.status, 0);
  assert.equal(r.report.verdict, "needs_review");
  assert.equal(r.report.flips[0].direction, "stricter");
});

test("flip share over the limit blocks on a minor bump", () => {
  const d = rd("decisions.jsonl");
  const id = d.find((x) => x.dp === "DP-TONE" && x.outcome === "publish").decision_id;
  const m = join(mkdtempSync(join(tmpdir(), "mot-")), "m.txt"); writeFileSync(m, id + "\n");
  const r = run(d, rd("head.jsonl").map(withHead(id, { outcome: "needs_revision", rule_ids: ["TONE-1"] })), ["--motivating", m]);
  assert.equal(r.status, 1);
  assert.match(r.report.blockers[0], /DP-TONE: flip share 6\.6667% is over the 5% limit/);
});

test("DP-APPEAL proposing reject is an error", () => {
  const d = rd("decisions.jsonl");
  const id = d.find((x) => x.dp === "DP-APPEAL" && x.outcome === "publish").decision_id;
  const r = run(d, rd("head.jsonl").map(withHead(id, { outcome: "reject", rule_ids: ["APPEAL-1"] })), ["--bump", "major"]);
  assert.equal(r.status, 1);
  assert.ok(r.report.blockers.some((b) => /can never produce/.test(b)));
});

test("direction classification table", () => {
  const rules = new Map([["A", { enforcement: "advisory" }], ["N", { enforcement: "needs_revision" }], ["R", { enforcement: "reject" }]]);
  const row = (outcome, rule_ids = [], field = "f") => ({ outcome, rule_ids, field_ref: { field } });
  const cases = [
    [row("publish"), row("needs_revision", ["N"]), "stricter"],
    [row("reject", ["R"]), row("hold", ["R"]), "more_permissive"],
    [row("hold"), row("route_external"), "stricter"],
    [row("route_external"), row("escalate_human"), "stricter"],
    [row("needs_revision", ["N"]), row("needs_revision", ["R"]), "stricter"],
    [row("needs_revision", ["R"]), row("needs_revision", ["A"]), "more_permissive"],
    [row("needs_revision", ["N"]), row("needs_revision", ["N"], "g"), "lateral"],
    [row("needs_revision", ["N"]), row("needs_revision", ["N"]), "none"],
  ];
  for (const [a, b, want] of cases) assert.equal(classify(a, b, rules).direction, want);
});

test("empty replay set reports no data and exits 0 with a warning", () => {
  const r = run([], []);
  assert.equal(r.status, 0);
  assert.equal(r.report.verdict, "no_data");
  assert.match(r.stderr, /no data/);
});

test("missing head recording is an input error (exit 2)", () => {
  const r = run(rd("decisions.jsonl"), []);
  assert.equal(r.status, 2);
});

test("cost is flips times cost_per_run", () => {
  const rep = buildReport({ decisions: [{ decision_id: "x", dp: "DP-TONE", jurisdiction: "j", outcome: "publish", rule_ids: [], confidence: 0.9 }], heads: new Map([["x", { outcome: "needs_revision", rule_ids: ["TONE-1"], confidence: 0.9 }]]), rules: new Map([["TONE-1", { tier: "procedure", enforcement: "needs_revision" }]]), protectedCore: new Set(), limits: { minor_flip_pct: 5, cost_per_run: 0.25 }, bump: "major" });
  assert.deepEqual(rep.remoderation, { volume: 1, estimated_cost: 0.25 });
});
