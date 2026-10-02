import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

// 10-u62: unsafe DP-SOURCE-TRUST and DP-CRITERIA outputs must be unrepresentable. Compiled strict, like can_server.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (dp) => new Ajv2020({ strict: true, strictTypes: true, strictRequired: true, allErrors: true })
  .compile(JSON.parse(readFileSync(join(ROOT, "decision-points", dp, "schema.json"), "utf8")));
const run = (name, validate, cases) => test(name, () => {
  for (const [label, out, ok] of cases) {
    const clean = Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
    assert.equal(validate(clean), ok, `${label}: ${JSON.stringify(validate.errors?.slice(0, 2))}`);
  }
});

// ---- DP-SOURCE-TRUST
const s = (ref, verdict) => ({ ref, verdict, reason: "r" });
const spub = { outcome: "publish", rule_ids: ["SOURCE-1"], confidence: 0.95, reasons: ["r"], per_source: [s("src-1", "establishes")] };
const snr = { outcome: "needs_revision", rule_ids: ["SOURCE-1"], confidence: 0.8, reasons: ["r"], revision_hint: "Add a source.", per_source: [s("src-1", "mentions_only")] };
const shold = { outcome: "hold", rule_ids: [], confidence: 0.4, reasons: ["r"], hold_reason: "cannot_decide" };
run("DP-SOURCE-TRUST schema negatives", load("DP-SOURCE-TRUST"), [
  ["valid publish", spub, true],
  ["valid publish with a mentions_only extra", { ...spub, per_source: [s("src-1", "establishes"), s("src-2", "mentions_only")] }, true],
  ["valid needs_revision", snr, true],
  ["valid needs_revision with no sources", { ...snr, per_source: undefined, revision_hint: "Add a source or ask the reviewers." }, true],
  ["valid hold", shold, true],
  ["valid hold missing_input", { ...shold, hold_reason: "missing_input", missing_inputs: ["source_count"] }, true],
  ["reject outcome", { ...snr, outcome: "reject" }, false],
  ["escalate_human outcome", { ...shold, outcome: "escalate_human" }, false],
  ["route_external outcome", { ...shold, outcome: "route_external" }, false],
  ["publish without rule ids", { ...spub, rule_ids: [] }, false],
  ["publish citing only EVID-URL-1", { ...spub, rule_ids: ["EVID-URL-1"] }, false],
  ["unknown rule id", { ...spub, rule_ids: ["SOURCE-1", "X-1"] }, false],
  ["publish at confidence 0.89", { ...spub, confidence: 0.89 }, false],
  ["publish at confidence 0.9", { ...spub, confidence: 0.9 }, true],
  ["publish without per_source", { ...spub, per_source: undefined }, false],
  ["publish with no establishing source", { ...spub, per_source: [s("src-1", "mentions_only")] }, false],
  ["publish with a not_trusted source", { ...spub, per_source: [s("src-1", "establishes"), s("src-2", "not_trusted")] }, false],
  ["publish with an unchecked source", { ...spub, per_source: [s("src-1", "establishes"), s("src-2", "unchecked")] }, false],
  ["publish with a hint", { ...spub, revision_hint: "x" }, false],
  ["publish with a hold_reason", { ...spub, hold_reason: "cannot_decide" }, false],
  ["needs_revision without a hint", { ...snr, revision_hint: undefined }, false],
  ["needs_revision without rule ids", { ...snr, rule_ids: [] }, false],
  ["needs_revision at confidence 0.74", { ...snr, confidence: 0.74 }, false],
  ["needs_revision with a hold_reason", { ...snr, hold_reason: "cannot_decide" }, false],
  ["hold without hold_reason", { ...shold, hold_reason: undefined }, false],
  ["hold missing_input without missing_inputs", { ...shold, hold_reason: "missing_input" }, false],
  ["hold missing_input with unknown input", { ...shold, hold_reason: "missing_input", missing_inputs: ["vibes"] }, false],
  ["hold cannot_decide with missing_inputs", { ...shold, missing_inputs: ["description"] }, false],
  ["hold_reason on a non-hold outcome", { ...snr, hold_reason: "missing_input", missing_inputs: ["description"] }, false],
  ["verdict trusted (not a verdict)", { ...spub, per_source: [s("src-1", "trusted")] }, false],
  ["reason over 300 characters", { ...spub, per_source: [{ ref: "src-1", verdict: "establishes", reason: "x".repeat(301) }] }, false],
  ["reasons item over 600 characters", { ...spub, reasons: ["x".repeat(601)] }, false],
  ["a URL as a ref", { ...spub, per_source: [s("https://x.example.org", "establishes")] }, false],
  ["unknown key", { ...spub, fetched: true }, false],
  ["needs_revision with an unchecked source", { ...snr, per_source: [s("src-1", "unchecked")] }, false],
  ["needs_revision with a mix incl. unchecked", { ...snr, per_source: [s("src-1", "not_trusted"), s("src-2", "unchecked")] }, false],
  ["hold missing_input jurisdiction", { ...shold, hold_reason: "missing_input", missing_inputs: ["jurisdiction", "scope"] }, true],
  ["exact duplicate per_source item", { ...spub, per_source: [s("src-1", "establishes"), s("src-1", "establishes")] }, false],
]);

// ---- DP-CRITERIA
const pc = (ref, o = {}) => ({ ref, measurable: true, lawful: "yes", fits: true, ...o });
const none = (l) => ({ layer: l, corpus_version: "fiktiva-x@0.1.0", finding: "none_found" });
const con = { layer: "L4", article_id: "L4/fiktiva/statutes/art-6", corpus_version: "fiktiva-statutes@0.1.0", finding: "constrains" };
const cpub = { outcome: "publish", rule_ids: ["CRITERIA-1"], confidence: 0.95, reasons: ["r"], per_criterion: [pc("c-1")] };
const cnr = { outcome: "needs_revision", rule_ids: ["CRITERIA-1"], confidence: 0.8, reasons: ["r"], revision_hint: "Rewrite c-1.", per_criterion: [pc("c-1", { measurable: false })] };
const L6 = ["L1", "L2", "L3", "L4", "L5", "L6"];
const LG = ["CRITERIA-1", "LEGAL-STACK-1", "LEGAL-CITE-1"];
const crej = { outcome: "reject", rule_ids: LG, confidence: 0.95, reasons: ["r"], per_criterion: [pc("c-1", { lawful: "no" })], legal_findings: [con] };
const chold = { outcome: "hold", rule_ids: [], confidence: 0.4, reasons: ["r"], hold_reason: "cannot_decide" };
run("DP-CRITERIA schema negatives", load("DP-CRITERIA"), [
  ["valid publish", cpub, true],
  ["valid publish with law lines", { ...cpub, rule_ids: LG, legal_findings: L6.map(none) }, true],
  ["valid needs_revision", cnr, true],
  ["valid needs_revision with no criteria", { ...cnr, per_criterion: undefined }, true],
  ["valid reject", crej, true],
  ["valid hold", chold, true],
  ["valid hold layer_conflict", { ...chold, hold_reason: "layer_conflict", conflict_note: "n", rule_ids: LG, legal_findings: [{ ...con, finding: "conflict" }, { layer: "L5", article_id: "L5/fiktiva/region/art-2", corpus_version: "v", finding: "conflict" }] }, true],
  ["valid hold with no legal lines", { ...chold, hold_reason: "missing_input", missing_inputs: ["legal_layer"], rule_ids: ["LEGAL-STACK-1"], legal_findings: [{ layer: "L0", finding: "none_found" }] }, true],
  ["escalate_human outcome", { ...chold, outcome: "escalate_human" }, false],
  ["route_external outcome", { ...chold, outcome: "route_external" }, false],
  // publish
  ["publish without rule ids", { ...cpub, rule_ids: [] }, false],
  ["publish at confidence 0.89", { ...cpub, confidence: 0.89 }, false],
  ["publish without per_criterion", { ...cpub, per_criterion: undefined }, false],
  ["publish with an unmeasurable criterion", { ...cpub, per_criterion: [pc("c-1"), pc("c-2", { measurable: false })] }, false],
  ["publish with a criterion that does not fit", { ...cpub, per_criterion: [pc("c-1", { fits: false })] }, false],
  ["publish with lawful not_judged", { ...cpub, per_criterion: [pc("c-1", { lawful: "not_judged" })] }, false],
  ["publish with lawful no", { ...cpub, per_criterion: [pc("c-1", { lawful: "no" })] }, false],
  ["publish over a constrains finding", { ...cpub, rule_ids: LG, legal_findings: [con] }, false],
  ["publish over a conflict finding", { ...cpub, rule_ids: LG, legal_findings: [{ ...con, finding: "conflict" }] }, false],
  ["publish over only an L0 finding", { ...cpub, rule_ids: LG, legal_findings: [{ layer: "L0", finding: "none_found" }] }, false],
  ["publish citing legal rules without findings", { ...cpub, rule_ids: LG }, false],
  ["publish with a hint", { ...cpub, revision_hint: "x" }, false],
  // needs_revision
  ["needs_revision without a hint", { ...cnr, revision_hint: undefined }, false],
  ["needs_revision without CRITERIA-1", { ...cnr, rule_ids: [] }, false],
  ["needs_revision at confidence 0.74", { ...cnr, confidence: 0.74 }, false],
  ["needs_revision over an unlawful criterion", { ...cnr, per_criterion: [pc("c-1", { lawful: "no" })] }, false],
  // reject: only for an unlawful criterion with a cited article
  ["reject for vagueness", { ...crej, per_criterion: [pc("c-1", { measurable: false })] }, false],
  ["reject without a finding", { ...crej, legal_findings: undefined }, false],
  ["reject with legal_findings of none_found", { ...crej, legal_findings: ["L1", "L2"].map(none) }, false],
  ["reject without article_id", { ...crej, legal_findings: [{ ...con, article_id: undefined }] }, false],
  ["reject without corpus_version", { ...crej, legal_findings: [{ ...con, corpus_version: undefined }] }, false],
  ["reject without LEGAL-CITE-1", { ...crej, rule_ids: ["CRITERIA-1", "LEGAL-STACK-1"] }, false],
  ["reject without CRITERIA-1", { ...crej, rule_ids: ["LEGAL-STACK-1", "LEGAL-CITE-1"] }, false],
  ["reject at confidence 0.91", { ...crej, confidence: 0.91 }, false],
  ["reject at confidence 0.92", { ...crej, confidence: 0.92 }, true],
  ["reject with a conflict finding beside the constrains", { ...crej, legal_findings: [con, { ...con, layer: "L5", article_id: "L5/fiktiva/region/art-2", finding: "conflict" }] }, false],
  ["reject with a hint", { ...crej, revision_hint: "x" }, false],
  // findings shape
  ["L0 finding with an article id", { ...chold, hold_reason: "missing_input", missing_inputs: ["legal_layer"], rule_ids: ["LEGAL-STACK-1"], legal_findings: [{ layer: "L0", finding: "none_found", article_id: "L1/x/y/z" }] }, false],
  ["L2 finding without corpus_version", { ...crej, legal_findings: [{ ...con, corpus_version: undefined }, none("L2")] }, false],
  ["none_found with an article id", { ...cpub, rule_ids: LG, legal_findings: [{ ...none("L1"), article_id: "L1/fiktiva/rights/art-3" }] }, false],
  ["permits without article id", { ...cpub, rule_ids: LG, legal_findings: [{ ...none("L1"), finding: "permits" }] }, false],
  // hold
  ["hold without hold_reason", { ...chold, hold_reason: undefined }, false],
  ["hold missing_input without missing_inputs", { ...chold, hold_reason: "missing_input" }, false],
  ["hold missing_input with unknown input", { ...chold, hold_reason: "missing_input", missing_inputs: ["vibes"] }, false],
  ["hold layer_conflict without conflict_note", { ...chold, hold_reason: "layer_conflict" }, false],
  ["conflict finding on needs_revision", { ...cnr, rule_ids: LG, conflict_note: "n", legal_findings: [{ ...con, finding: "conflict" }] }, false],
  ["conflict finding on hold without conflict_note", { ...chold, rule_ids: LG, legal_findings: [{ ...con, finding: "conflict" }] }, false],
  ["unknown rule id", { ...cpub, rule_ids: ["CRITERIA-1", "X-1"] }, false],
  ["reason over 300 chars in a hint", { ...cpub, per_criterion: [pc("c-1", { hint: "x".repeat(301) })] }, false],
  ["lawful true (not an enum value)", { ...cpub, per_criterion: [pc("c-1", { lawful: true })] }, false],
  ["unknown key", { ...cpub, met: true }, false],
  ["publish with a partial legal_findings (L1 only)", { ...cpub, rule_ids: LG, legal_findings: [none("L1")] }, false],
  ["publish with five of six layers", { ...cpub, rule_ids: LG, legal_findings: L6.slice(0, 5).map(none) }, false],
  ["publish with all six layers permits/none_found", { ...cpub, rule_ids: LG, legal_findings: [...L6.slice(0, 5).map(none), { layer: "L6", article_id: "L6/fiktiva/bylaws/art-1", corpus_version: "v", finding: "permits" }] }, true],
  ["exact duplicate per_criterion item", { ...cpub, per_criterion: [pc("c-1"), pc("c-1")] }, false],
]);
