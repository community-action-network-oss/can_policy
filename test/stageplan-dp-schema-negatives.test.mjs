import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

// 10-u63: unsafe DP-STAGE-PLAN outputs must be unrepresentable. Compiled strict, like can_server.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (dp) => new Ajv2020({ strict: true, strictTypes: true, strictRequired: true, allErrors: true })
  .compile(JSON.parse(readFileSync(join(ROOT, "decision-points", dp, "schema.json"), "utf8")));
const run = (name, validate, cases) => test(name, () => {
  for (const [label, out, ok] of cases) {
    const clean = Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
    assert.equal(validate(clean), ok, `${label}: ${JSON.stringify(validate.errors?.slice(0, 2))}`);
  }
});

// ---- DP-STAGE-PLAN
const sv = (ref, verdict = "ok", o = {}) => ({ ref, verdict, ...o });
const all = { reason_given: true, removals_justified: true, criteria_reachable: true };
const spub = { outcome: "publish", rule_ids: ["STAGE-GATE-1"], confidence: 0.95, reasons: ["r"], trigger: "submit", uncovered_final_criteria: [], per_stage: [sv("s-1"), sv("s-2")] };
const spc = { ...spub, trigger: "plan_change", rule_ids: ["STAGE-GATE-1", "PLAN-CHANGE-1"], change_checks: all, per_stage: [sv("s-1"), sv("r-1")] };
const snr = { outcome: "needs_revision", rule_ids: ["STAGE-GATE-1"], confidence: 0.8, reasons: ["r"], trigger: "submit", revision_hint: "Fix s-2.", uncovered_final_criteria: ["f-2"], per_stage: [sv("s-1"), sv("s-2", "vague_catch_all", { hint: "h" })] };
const shold = { outcome: "hold", rule_ids: [], confidence: 0.4, reasons: ["r"], hold_reason: "cannot_decide" };
run("DP-STAGE-PLAN schema negatives", load("DP-STAGE-PLAN"), [
  ["valid publish", spub, true],
  ["valid absent plan publish", { ...spub, per_stage: undefined, plan_absent: true }, true],
  ["valid plan change publish", spc, true],
  ["valid needs_revision", snr, true],
  ["valid needs_revision plan change", { ...snr, trigger: "plan_change", rule_ids: ["STAGE-GATE-1", "PLAN-CHANGE-1"], change_checks: { ...all, removals_justified: false } }, true],
  ["valid hold", shold, true],
  ["valid hold missing_input", { ...shold, hold_reason: "missing_input", missing_inputs: ["dag_check"] }, true],
  ["reject outcome", { ...snr, outcome: "reject" }, false],
  ["route_external outcome", { ...shold, outcome: "route_external" }, false],
  ["escalate_human outcome", { ...shold, outcome: "escalate_human" }, false],
  ["publish without rule ids", { ...spub, rule_ids: [] }, false],
  ["publish citing only PLAN-CHANGE-1 on submit", { ...spub, rule_ids: ["PLAN-CHANGE-1"] }, false],
  ["unknown rule id", { ...spub, rule_ids: ["STAGE-GATE-1", "X-1"] }, false],
  ["publish at confidence 0.89", { ...spub, confidence: 0.89 }, false],
  ["publish at confidence 0.9", { ...spub, confidence: 0.9 }, true],
  ["publish without trigger", { ...spub, trigger: undefined }, false],
  ["publish without uncovered list", { ...spub, uncovered_final_criteria: undefined }, false],
  ["publish with an uncovered final criterion", { ...spub, uncovered_final_criteria: ["f-1"] }, false],
  ["publish with neither per_stage nor plan_absent", { ...spub, per_stage: undefined }, false],
  ["publish with plan_absent false and no per_stage", { ...spub, per_stage: undefined, plan_absent: false }, false],
  ["publish with plan_absent and per_stage", { ...spub, plan_absent: true }, false],
  ["publish with a vague_catch_all stage", { ...spub, per_stage: [sv("s-1"), sv("s-2", "vague_catch_all")] }, false],
  ["publish with a duplicate stage", { ...spub, per_stage: [sv("s-1", "duplicate"), sv("s-2")] }, false],
  ["publish with a misordered stage", { ...spub, per_stage: [sv("s-1", "misordered"), sv("s-2")] }, false],
  ["publish with a not_independent stage", { ...spub, per_stage: [sv("s-1"), sv("s-2", "not_independent")] }, false],
  ["publish with an unjustified removal", { ...spc, per_stage: [sv("s-1"), sv("r-1", "unjustified_removal")] }, false],
  ["publish with an unjustified skip", { ...spub, per_stage: [sv("s-1", "unjustified_skip")] }, false],
  ["publish with a hint", { ...spub, revision_hint: "x" }, false],
  ["publish with a hold_reason", { ...spub, hold_reason: "cannot_decide" }, false],
  ["plan change publish without PLAN-CHANGE-1", { ...spc, rule_ids: ["STAGE-GATE-1"] }, false],
  ["plan change publish without change_checks", { ...spc, change_checks: undefined }, false],
  ["plan change publish with reason not given", { ...spc, change_checks: { ...all, reason_given: false } }, false],
  ["plan change publish with removals not justified", { ...spc, change_checks: { ...all, removals_justified: false } }, false],
  ["plan change publish with criteria unreachable", { ...spc, change_checks: { ...all, criteria_reachable: false } }, false],
  ["plan change published as an absent plan", { ...spc, per_stage: undefined, plan_absent: true }, false],
  ["plan change needs_revision without PLAN-CHANGE-1", { ...snr, trigger: "plan_change", change_checks: all }, false],
  ["needs_revision without a hint", { ...snr, revision_hint: undefined }, false],
  ["needs_revision with an empty hint", { ...snr, revision_hint: "" }, false],
  ["needs_revision without rule ids", { ...snr, rule_ids: [] }, false],
  ["needs_revision without trigger", { ...snr, trigger: undefined }, false],
  ["needs_revision at confidence 0.74", { ...snr, confidence: 0.74 }, false],
  ["needs_revision with a hold_reason", { ...snr, hold_reason: "cannot_decide" }, false],
  ["hold without hold_reason", { ...shold, hold_reason: undefined }, false],
  ["hold missing_input without missing_inputs", { ...shold, hold_reason: "missing_input" }, false],
  ["hold missing_input with an unknown input", { ...shold, hold_reason: "missing_input", missing_inputs: ["vibes"] }, false],
  ["hold cannot_decide with missing_inputs", { ...shold, missing_inputs: ["dag_check"] }, false],
  ["hold_reason missing_input on publish", { ...spub, hold_reason: "missing_input", missing_inputs: ["dag_check"] }, false],
  ["unknown hold_reason", { ...shold, hold_reason: "conflict" }, false],
  ["a name as a ref", { ...snr, per_stage: [sv("Alice Example")] }, false],
  ["a free text final criterion ref", { ...snr, uncovered_final_criteria: ["The pump is fixed"] }, false],
  ["duplicate uncovered ref", { ...snr, uncovered_final_criteria: ["f-1", "f-1"] }, false],
  ["exact duplicate per_stage item", { ...spub, per_stage: [sv("s-1"), sv("s-1")] }, false],
  ["hint over 300 characters", { ...snr, per_stage: [sv("s-1", "vague_catch_all", { hint: "x".repeat(301) })] }, false],
  ["reasons item over 600 characters", { ...spub, reasons: ["x".repeat(601)] }, false],
  ["revision_hint over 600 characters", { ...snr, revision_hint: "x".repeat(601) }, false],
  ["unknown key", { ...spub, auto_start: false }, false],
  ["unknown verdict", { ...spub, per_stage: [sv("s-1", "fine")] }, false],
  ["unknown trigger", { ...spub, trigger: "resubmit" }, false],
]);

