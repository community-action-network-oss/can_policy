import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";

// 10-u64: unsafe DP-STAGE-RESOLUTION outputs must be unrepresentable. Compiled strict, like can_server.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "decision-points", "DP-STAGE-RESOLUTION");
const validate = new Ajv2020({ strict: true, strictTypes: true, strictRequired: true, allErrors: true }).compile(JSON.parse(readFileSync(join(DIR, "schema.json"), "utf8")));

const m = (ref, ids = ["e-1"], o = {}) => ({ criterion_ref: ref, met: true, evidence_ids: ids, ...o });
const u = (ref, o = {}) => ({ criterion_ref: ref, met: false, evidence_ids: [], gap: "not_addressed", hint: "h", ...o });
const pub = { outcome: "publish", rule_ids: ["STAGE-RESOLVE-1", "STAGE-GATE-1"], confidence: 0.95, reasons: ["r"], trigger: "evidence_submit", choice_gate_ok: true, per_criterion: [m("c-1"), m("c-2", ["e-1", "e-2"])] };
const nr = { outcome: "needs_revision", rule_ids: ["STAGE-RESOLVE-1"], confidence: 0.8, reasons: ["r"], trigger: "evidence_submit", choice_gate_ok: true, revision_hint: "Fix c-2.", per_criterion: [m("c-1"), u("c-2")] };
const hold = { outcome: "hold", rule_ids: [], confidence: 0.4, reasons: ["r"], hold_reason: "cannot_decide" };

const cases = [
  ["valid publish", pub, true],
  ["valid publish on rule_change", { ...pub, trigger: "rule_change" }, true],
  ["valid needs_revision", nr, true],
  ["valid needs_revision choice gate open", { ...nr, choice_gate_ok: false, per_criterion: [m("c-1")] }, true],
  ["valid needs_revision with no evidence", { ...nr, per_criterion: [u("c-1")] }, true],
  ["valid hold", hold, true],
  ["valid hold missing_input", { ...hold, hold_reason: "missing_input", missing_inputs: ["predecessors", "choice"] }, true],
  ["reject outcome", { ...nr, outcome: "reject" }, false],
  ["route_external outcome", { ...hold, outcome: "route_external" }, false],
  ["escalate_human outcome", { ...hold, outcome: "escalate_human" }, false],
  ["publish without per_criterion", { ...pub, per_criterion: undefined }, false],
  ["publish with an unmet criterion", { ...pub, per_criterion: [m("c-1"), u("c-2")] }, false],
  ["publish with a met item that has no evidence", { ...pub, per_criterion: [m("c-1", [])] }, false],
  ["publish with a met item carrying a gap", { ...pub, per_criterion: [m("c-1", ["e-1"], { gap: "partly_met" })] }, false],
  ["publish with empty per_criterion", { ...pub, per_criterion: [] }, false],
  ["publish without STAGE-GATE-1", { ...pub, rule_ids: ["STAGE-RESOLVE-1"] }, false],
  ["publish without STAGE-RESOLVE-1", { ...pub, rule_ids: ["STAGE-GATE-1"] }, false],
  ["publish with no rule ids", { ...pub, rule_ids: [] }, false],
  ["unknown rule id", { ...pub, rule_ids: ["STAGE-RESOLVE-1", "STAGE-GATE-1", "X-1"] }, false],
  ["publish at confidence 0.89", { ...pub, confidence: 0.89 }, false],
  ["publish at confidence 0.9", { ...pub, confidence: 0.9 }, true],
  ["publish without trigger", { ...pub, trigger: undefined }, false],
  ["publish without choice_gate_ok", { ...pub, choice_gate_ok: undefined }, false],
  ["publish with choice gate open", { ...pub, choice_gate_ok: false }, false],
  ["publish with a hint", { ...pub, revision_hint: "x" }, false],
  ["publish with a hold_reason", { ...pub, hold_reason: "cannot_decide" }, false],
  ["unmet item without a gap", { ...nr, per_criterion: [m("c-1"), { criterion_ref: "c-2", met: false, evidence_ids: [], hint: "h" }] }, false],
  ["unmet item without a hint", { ...nr, per_criterion: [m("c-1"), { criterion_ref: "c-2", met: false, evidence_ids: [], gap: "not_addressed" }] }, false],
  ["unmet item may cite the evidence it judged (allowed by design, see schema \)", { ...nr, per_criterion: [m("c-1"), u("c-2", { evidence_ids: ["e-1"], gap: "off_topic" })] }, true],
  ["unknown gap", { ...nr, per_criterion: [u("c-1", { gap: "vibes" })] }, false],
  ["needs_revision all met and gate ok", { ...nr, per_criterion: [m("c-1"), m("c-2")] }, false],
  ["needs_revision without per_criterion and gate ok", { ...nr, per_criterion: undefined }, false],
  ["needs_revision without a hint", { ...nr, revision_hint: undefined }, false],
  ["needs_revision with an empty hint", { ...nr, revision_hint: "" }, false],
  ["needs_revision without rule ids", { ...nr, rule_ids: [] }, false],
  ["needs_revision citing only STAGE-GATE-1", { ...nr, rule_ids: ["STAGE-GATE-1"] }, false],
  ["needs_revision without trigger", { ...nr, trigger: undefined }, false],
  ["needs_revision without choice_gate_ok", { ...nr, choice_gate_ok: undefined }, false],
  ["needs_revision at confidence 0.74", { ...nr, confidence: 0.74 }, false],
  ["needs_revision with a hold_reason", { ...nr, hold_reason: "cannot_decide" }, false],
  ["hold without hold_reason", { ...hold, hold_reason: undefined }, false],
  ["hold with per_criterion", { ...hold, per_criterion: [u("c-1")] }, false],
  ["hold with choice_gate_ok", { ...hold, choice_gate_ok: true }, false],
  ["hold missing_input without missing_inputs", { ...hold, hold_reason: "missing_input" }, false],
  ["hold missing_input with an unknown input", { ...hold, hold_reason: "missing_input", missing_inputs: ["vibes"] }, false],
  ["hold missing_input with duplicate inputs", { ...hold, hold_reason: "missing_input", missing_inputs: ["choice", "choice"] }, false],
  ["hold cannot_decide with missing_inputs", { ...hold, missing_inputs: ["choice"] }, false],
  ["hold_reason missing_input on publish", { ...pub, hold_reason: "missing_input", missing_inputs: ["choice"] }, false],
  ["unknown hold_reason", { ...hold, hold_reason: "conflict" }, false],
  ["a name as a criterion ref", { ...nr, per_criterion: [u("Alice Example")] }, false],
  ["a free text evidence id", { ...pub, per_criterion: [m("c-1", ["the log extract"])] }, false],
  ["duplicate evidence ids in an item", { ...pub, per_criterion: [m("c-1", ["e-1", "e-1"])] }, false],
  ["exact duplicate per_criterion item", { ...pub, per_criterion: [m("c-1"), m("c-1")] }, false],
  ["item hint over 300 characters", { ...nr, per_criterion: [u("c-1", { hint: "x".repeat(301) })] }, false],
  ["reasons item over 600 characters", { ...pub, reasons: ["x".repeat(601)] }, false],
  ["revision_hint over 600 characters", { ...nr, revision_hint: "x".repeat(601) }, false],
  ["unknown key", { ...pub, auto_start: false }, false],
  ["unknown trigger", { ...pub, trigger: "resubmit" }, false],
  ["an old DP-STAGE style trigger", { ...pub, trigger: "plan_change" }, false],
];
test("DP-STAGE-RESOLUTION schema negatives", () => {
  for (const [label, out, ok] of cases) {
    const clean = Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
    assert.equal(validate(clean), ok, `${label}: ${JSON.stringify(validate.errors?.slice(0, 2))}`);
  }
});

test("DP-STAGE-RESOLUTION is appealable, enforces only its two rules, and DP-STAGE stays retired", () => {
  const sec = parse(readFileSync(join(DIR, "pack-section.yaml"), "utf8"));
  assert.equal(sec.appealable, true);
  assert.deepEqual([...sec.enforces].sort(), ["STAGE-GATE-1", "STAGE-RESOLVE-1"]);
  assert.deepEqual(sec.outcomes, ["publish", "needs_revision", "hold"]);
  assert.equal(existsSync(join(ROOT, "decision-points/DP-STAGE")), false);
  const thr = parse(readFileSync(join(DIR, "eval/thresholds.yaml"), "utf8"));
  assert.equal(thr.min_recall_harmful, 0.95);
});
