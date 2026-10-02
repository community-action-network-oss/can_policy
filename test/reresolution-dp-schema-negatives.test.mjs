import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

// 10-u59: unsafe DP-RERESOLUTION outputs must be unrepresentable. Compiled strict, like can_server.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(ROOT, "decision-points", "DP-RERESOLUTION", "schema.json"), "utf8"));
const validate = new Ajv2020({ strict: true, strictTypes: true, strictRequired: true, allErrors: true }).compile(schema);

const v = { old_policy_version: "fiktiva-city@0.2.0", new_policy_version: "fiktiva-city@0.3.0" };
const f = (o = {}) => ({ layer: "L2", article_id: "L2/fiktiva/union/art-4", corpus_version: "fiktiva-union@0.1.0+254d205f7f55", effect: "changes_conclusion", ...o });
const none = (l) => ({ layer: l, corpus_version: "fiktiva-x@0.1.0", effect: "none_found" });
const LEG = ["RERESOLVE-1", "LEGAL-STACK-1", "LEGAL-CITE-1"];
const pol = { trigger: "policy_change", ...v, confidence: 0.95, reasons: ["r"], rule_ids: ["RERESOLVE-1"] };
const leg = { ...pol, trigger: "legal_corpus_change", rule_ids: LEG };
const reopen = { ...pol, resolution: "reopen", outcome: "route_external", reopen_target: "stages", affected_stage_ids: ["stage-3"], changed_rule_ids: ["EVID-URL-1"] };
const annotate = { ...pol, resolution: "annotate", outcome: "needs_revision", annotate_reason: "informational", changed_rule_ids: ["TONE-1"] };
const keep = { ...pol, resolution: "keep", outcome: "publish" };
const hold = { ...pol, resolution: "hold", outcome: "hold", hold_reason: "cannot_decide", rule_ids: [] };

const cases = [
  ["valid keep", keep, true],
  ["valid annotate", annotate, true],
  ["valid reopen of stages", reopen, true],
  ["valid reopen of the problem", { ...reopen, reopen_target: "problem", affected_stage_ids: undefined }, true],
  ["valid hold", hold, true],
  // no reject, no delete, no escalation
  ["outcome reject", { ...keep, outcome: "reject" }, false],
  ["outcome escalate_human", { ...hold, outcome: "escalate_human" }, false],
  ["resolution reject", { ...keep, resolution: "reject" }, false],
  ["resolution delete", { ...keep, resolution: "delete" }, false],
  ["keep with outcome route_external", { ...keep, outcome: "route_external" }, false],
  ["reopen with outcome publish", { ...reopen, outcome: "publish" }, false],
  ["hold with outcome publish", { ...hold, outcome: "publish" }, false],
  ["no resolution", { ...keep, resolution: undefined }, false],
  // a decision cites its rule and both versions
  ["keep without RERESOLVE-1", { ...keep, rule_ids: [] }, false],
  ["annotate without RERESOLVE-1", { ...annotate, rule_ids: ["TONE-1"] }, false],
  ["reopen without RERESOLVE-1", { ...reopen, rule_ids: [] }, false],
  ["keep without versions", { ...keep, old_policy_version: undefined }, false],
  ["reopen without new version", { ...reopen, new_policy_version: undefined }, false],
  // reopen is the expensive error
  ["reopen at confidence 0.89", { ...reopen, confidence: 0.89 }, false],
  ["reopen at confidence 0.9", { ...reopen, confidence: 0.9 }, true],
  ["reopen without a target", { ...reopen, reopen_target: undefined }, false],
  ["reopen stages without stage ids", { ...reopen, affected_stage_ids: undefined }, false],
  ["reopen stages with empty stage ids", { ...reopen, affected_stage_ids: [] }, false],
  ["reopen problem with stage ids", { ...reopen, reopen_target: "problem" }, false],
  ["reopen citing nothing that changed", { ...reopen, changed_rule_ids: undefined }, false],
  ["reopen with an annotate_reason", { ...reopen, annotate_reason: "not_feasible" }, false],
  ["reopen with infeasible_reason", { ...reopen, infeasible_reason: "problem_gone" }, false],
  ["keep with a reopen_target", { ...keep, reopen_target: "stages" }, false],
  ["annotate with a reopen_target", { ...annotate, reopen_target: "problem" }, false],
  ["hold with a reopen_target", { ...hold, reopen_target: "problem" }, false],
  ["hold with stage ids", { ...hold, affected_stage_ids: ["stage-3"] }, false],
  // annotate
  ["annotate without annotate_reason", { ...annotate, annotate_reason: undefined }, false],
  ["annotate not_feasible without infeasible_reason", { ...annotate, annotate_reason: "not_feasible" }, false],
  ["annotate not_feasible with infeasible_reason", { ...annotate, annotate_reason: "not_feasible", infeasible_reason: "lawful_completed_implementation" }, true],
  ["annotate low_confidence with infeasible_reason", { ...annotate, annotate_reason: "low_confidence", infeasible_reason: "problem_gone" }, false],
  ["annotate pointing at nothing", { ...annotate, changed_rule_ids: undefined }, false],
  ["unknown infeasible_reason", { ...annotate, annotate_reason: "not_feasible", infeasible_reason: "too_busy" }, false],
  // keep cannot hide a changed conclusion
  ["keep with a changes_conclusion finding", { ...leg, resolution: "keep", outcome: "publish", changed_findings: [f()] }, false],
  ["keep with a no_effect finding", { ...leg, resolution: "keep", outcome: "publish", changed_findings: [f({ effect: "no_effect" }), none("L6")] }, true],
  // hold
  ["hold without hold_reason", { ...hold, hold_reason: undefined }, false],
  ["hold missing_input without missing_inputs", { ...hold, hold_reason: "missing_input" }, false],
  ["hold missing_input with missing_inputs", { ...hold, hold_reason: "missing_input", missing_inputs: ["archive_record"] }, true],
  ["hold missing_input with unknown input", { ...hold, hold_reason: "missing_input", missing_inputs: ["vibes"] }, false],
  ["hold layer_conflict without conflict_note", { ...hold, hold_reason: "layer_conflict" }, false],
  ["hold layer_conflict with conflict_note", { ...hold, hold_reason: "layer_conflict", conflict_note: "n" }, true],
  ["keep with a hold_reason", { ...keep, hold_reason: "cannot_decide" }, false],
  ["annotate with conflict_note", { ...annotate, conflict_note: "n" }, false],
  // conflict never passes
  ["conflict finding on keep", { ...leg, resolution: "keep", outcome: "publish", changed_findings: [f({ effect: "conflict" }), f({ layer: "L1", article_id: "L1/fiktiva/rights/art-3", effect: "conflict" })] }, false],
  ["conflict finding on reopen", { ...reopen, trigger: "legal_corpus_change", rule_ids: LEG, changed_findings: [f(), f({ layer: "L1", article_id: "L1/fiktiva/rights/art-3", effect: "conflict" })] }, false],
  ["conflict finding on a hold without layer_conflict", { ...hold, trigger: "legal_corpus_change", rule_ids: LEG, hold_reason: "cannot_decide", changed_findings: [f({ effect: "conflict" })] }, false],
  ["conflict finding on a hold with layer_conflict and note", { ...hold, trigger: "legal_corpus_change", rule_ids: LEG, hold_reason: "layer_conflict", conflict_note: "n", changed_findings: [f({ effect: "conflict" })] }, true],
  ["conflict finding without a hold resolution", { ...leg, resolution: "annotate", outcome: "needs_revision", annotate_reason: "informational", changed_findings: [f({ effect: "conflict" })] }, false],
  // legal stack: fail closed
  ["legal keep without findings", { ...leg, resolution: "keep", outcome: "publish" }, false],
  ["legal keep with only L0 none_found", { ...leg, resolution: "keep", outcome: "publish", changed_findings: [{ layer: "L0", effect: "none_found" }] }, false],
  ["legal reopen with only L0 none_found", { ...reopen, trigger: "legal_corpus_change", rule_ids: LEG, changed_findings: [{ layer: "L0", effect: "none_found" }] }, false],
  ["legal annotate with only L0 none_found", { ...annotate, trigger: "legal_corpus_change", rule_ids: LEG, changed_findings: [{ layer: "L0", effect: "none_found" }] }, false],
  ["legal hold with only L0 none_found", { ...hold, trigger: "legal_corpus_change", rule_ids: LEG, hold_reason: "missing_input", missing_inputs: ["legal_layer"], changed_findings: [{ layer: "L0", effect: "none_found" }] }, true],
  ["legal keep where every layer is none_found", { ...leg, resolution: "keep", outcome: "publish", changed_findings: ["L1", "L2", "L3", "L4", "L5", "L6"].map(none) }, false],
  ["legal keep missing LEGAL-CITE-1", { ...leg, resolution: "keep", outcome: "publish", rule_ids: ["RERESOLVE-1", "LEGAL-STACK-1"], changed_findings: [f({ effect: "no_effect" })] }, false],
  ["legal keep with one judged layer", { ...leg, resolution: "keep", outcome: "publish", changed_findings: [f({ effect: "no_effect" })] }, true],
  ["legal reopen citing only a rule id", { ...reopen, trigger: "legal_corpus_change", rule_ids: LEG, changed_findings: [f({ effect: "no_effect" })] }, false],
  ["legal reopen with a changes_conclusion finding", { ...reopen, trigger: "legal_corpus_change", rule_ids: LEG, changed_rule_ids: undefined, changed_findings: [f()] }, true],
  ["legal rule ids on a policy keep without findings", { ...pol, rule_ids: LEG, resolution: "keep", outcome: "publish" }, false],
  ["policy-change keep needs no findings", keep, true],
  ["L0 item with an article id", { ...hold, changed_findings: [{ layer: "L0", effect: "none_found", article_id: "L2/x/y/z" }] }, false],
  ["L0 item that changes the conclusion", { ...hold, changed_findings: [{ layer: "L0", effect: "changes_conclusion" }] }, false],
  ["L2 finding without corpus_version", { ...leg, resolution: "keep", outcome: "publish", changed_findings: [f({ corpus_version: undefined, effect: "no_effect" })] }, false],
  ["cited finding without article_id", { ...leg, resolution: "keep", outcome: "publish", changed_findings: [f({ article_id: undefined, effect: "no_effect" })] }, false],
  ["unknown effect", { ...leg, resolution: "keep", outcome: "publish", changed_findings: [f({ effect: "permits" })] }, false],
  ["unknown trigger", { ...keep, trigger: "vibes" }, false],
  ["unknown extra key", { ...keep, article_text: "no" }, false],
];

for (const [name, raw, ok] of cases) {
  const out = JSON.parse(JSON.stringify(raw)); // drops the undefined keys
  test(`DP-RERESOLUTION: ${name} -> ${ok ? "valid" : "rejected"}`, () => assert.equal(validate(out), ok, JSON.stringify(validate.errors)));
}

test("DP-RERESOLUTION: no reject and no escalation in the outcome enum", () => {
  assert.deepEqual(schema.properties.outcome.enum, ["publish", "needs_revision", "route_external", "hold"]);
  assert.deepEqual(schema.properties.resolution.enum, ["keep", "annotate", "reopen", "hold"]);
});
