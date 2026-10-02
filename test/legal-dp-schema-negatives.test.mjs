import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

// 10-u58 constraints must survive the strict-mode rewrite: each bad output is still rejected.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = { rule_ids: [], confidence: 0.9, reasons: ["r"] };
const f = (o = {}) => ({ layer: "L1", article_id: "a1", corpus_version: "v1", finding: "permits", ...o });
const stuck = { blocking_constraint: "c", source_ref: "R@1", blocked_actions: ["x"], recheck_condition: "later" };
const cases = [
  ["cite rule without legal_findings", { outcome: "publish", rule_ids: ["LEGAL-CITE-1"] }, false],
  ["stack rule without legal_findings", { outcome: "publish", rule_ids: ["LEGAL-STACK-1"] }, false],
  ["cite rule with findings", { outcome: "publish", rule_ids: ["LEGAL-CITE-1"], legal_findings: [f()] }, true],
  ["topic-forbidden reject without topic_ban_ref", { outcome: "reject", rule_ids: ["TOPIC-FORBIDDEN-1"], legal_findings: [f()] }, false],
  ["topic-forbidden reject with topic_ban_ref", { outcome: "reject", rule_ids: ["TOPIC-FORBIDDEN-1"], legal_findings: [f({ topic_ban_ref: "a1" })] }, true],
  ["conflict hold without conflict_note", { outcome: "hold", legal_findings: [f({ finding: "conflict" })] }, false],
  ["conflict hold with conflict_note", { outcome: "hold", conflict_note: "n", legal_findings: [f({ finding: "conflict" })] }, true],
  ["L1 finding without corpus_version", { outcome: "publish", legal_findings: [{ layer: "L1", finding: "none_found" }] }, false],
  ["L1 cited finding without article_id", { outcome: "publish", legal_findings: [{ layer: "L1", corpus_version: "v1", finding: "permits" }] }, false],
  ["L0 finding needs no citation", { outcome: "publish", legal_findings: [{ layer: "L0", finding: "none_found" }] }, true],
];
const legalityOnly = [
  ["constrains hold without stuck_payload", { outcome: "hold", legal_findings: [f({ finding: "constrains" })] }, false],
  ["constrains hold with stuck_payload", { outcome: "hold", legal_findings: [f({ finding: "constrains" })], stuck_payload: stuck }, true],
  ["cited stuck_payload without layer/article_id/corpus_version", { outcome: "hold", rule_ids: ["LEGAL-CITE-1"], legal_findings: [f()], stuck_payload: stuck }, false],
  ["cited stuck_payload complete", { outcome: "hold", rule_ids: ["LEGAL-CITE-1"], legal_findings: [f()], stuck_payload: { ...stuck, layer: "L1", article_id: "a1", corpus_version: "v1" } }, true],
];
for (const [dp, outcomeOk, extra] of [["DP-LEGALITY", null, legalityOnly], ["DP-ELIGIBILITY", null, []], ["DP-LEGAL", null, []]]) {
  const validate = new Ajv2020({ allErrors: true }).compile(JSON.parse(readFileSync(join(ROOT, "decision-points", dp, "schema.json"), "utf8")));
  for (const [name, o, ok] of [...cases, ...extra]) {
    const out = { ...base, ...o };
    // DP-LEGAL has no reject outcome and DP-ELIGIBILITY/LEGAL have no stuck_payload: skip impossible shapes.
    if (dp === "DP-LEGAL" && o.outcome === "reject") continue;
    test(`${dp}: ${name} -> ${ok ? "valid" : "rejected"}`, () => assert.equal(validate(out), ok, JSON.stringify(validate.errors)));
  }
}
