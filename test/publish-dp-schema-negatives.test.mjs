import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

// 10-u63: unsafe DP-PUBLISH outputs must be unrepresentable. Compiled strict, like can_server.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (dp) => new Ajv2020({ strict: true, strictTypes: true, strictRequired: true, allErrors: true })
  .compile(JSON.parse(readFileSync(join(ROOT, "decision-points", dp, "schema.json"), "utf8")));
const run = (name, validate, cases) => test(name, () => {
  for (const [label, out, ok] of cases) {
    const clean = Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
    assert.equal(validate(clean), ok, `${label}: ${JSON.stringify(validate.errors?.slice(0, 2))}`);
  }
});

// ---- DP-PUBLISH
const DPS = ["ELIGIBILITY", "COMPLETENESS", "ASSUMPTIONS", "PRIVACY", "FRAMING", "DUPLICATE", "NAMING", "TONE", "EVIDENCE-TIER", "SOURCE-TRUST", "CRITERIA", "STAGE-PLAN", "LEGALITY", "CRISIS"].map((d) => `DP-${d}`);
const po = (over = {}) => DPS.map((dp) => ({ dp, outcome: over[dp] ?? "publish" }));
const checks = { review_complete: true, final_criteria_present: true, archive_used_as_review: false };
const cite = { ref: "o-1", path: "stage_plan.s-2", weight_reason: "Weighed; shown as a hint." };
const ppub = { outcome: "publish", rule_ids: ["REVIEW-1", "RECO-1"], confidence: 0.95, reasons: ["r"], prior_outcomes: po(), checks, reviews_completed: 3, open_count: 1, open_recommendations_cited: [cite] };
const pnr = { ...ppub, outcome: "needs_revision", revision_hint: "Fix the criteria.", prior_outcomes: po({ "DP-CRITERIA": "needs_revision" }) };
const prej = { outcome: "reject", rule_ids: ["REVIEW-1"], confidence: 0.95, reasons: ["r"], prior_outcomes: po({ "DP-LEGALITY": "reject" }) };
const pext = { ...prej, outcome: "route_external", confidence: 0.92, prior_outcomes: po({ "DP-CRISIS": "route_external" }) };
const phold = { outcome: "hold", rule_ids: [], confidence: 0.4, reasons: ["r"], hold_reason: "cannot_decide" };
run("DP-PUBLISH schema negatives", load("DP-PUBLISH"), [
  ["valid publish", ppub, true],
  ["valid publish with nothing open", { ...ppub, open_count: 0, open_recommendations_cited: [] }, true],
  ["valid needs_revision", pnr, true],
  ["valid reject", prej, true],
  ["valid reject beside needs_revision", { ...prej, prior_outcomes: po({ "DP-LEGALITY": "reject", "DP-TONE": "needs_revision" }) }, true],
  ["valid route_external", pext, true],
  ["valid hold", phold, true],
  ["valid hold prior_held", { ...phold, hold_reason: "prior_held", prior_outcomes: po({ "DP-PRIVACY": "hold" }) }, true],
  ["valid hold review_incomplete", { ...phold, hold_reason: "review_incomplete", checks: { ...checks, review_complete: false } }, true],
  ["valid hold missing_input", { ...phold, hold_reason: "missing_input", missing_inputs: ["dp_outcomes"] }, true],
  ["escalate_human outcome", { ...phold, outcome: "escalate_human" }, false],
  ["publish with one prior needs_revision", { ...ppub, prior_outcomes: po({ "DP-TONE": "needs_revision" }) }, false],
  ["publish with one prior hold", { ...ppub, prior_outcomes: po({ "DP-PRIVACY": "hold" }) }, false],
  ["publish with one prior reject", { ...ppub, prior_outcomes: po({ "DP-LEGALITY": "reject" }) }, false],
  ["publish over a protected-core refusal", { ...ppub, prior_outcomes: po({ "DP-ELIGIBILITY": "reject" }) }, false],
  ["publish with a prior route_external", { ...ppub, prior_outcomes: po({ "DP-CRISIS": "route_external" }) }, false],
  ["publish with 13 prior outcomes", { ...ppub, prior_outcomes: po().slice(1) }, false],
  ["publish without prior_outcomes", { ...ppub, prior_outcomes: undefined }, false],
  ["publish with a repeated dp hiding a missing one", { ...ppub, prior_outcomes: [...po().slice(1), { dp: "DP-TONE", outcome: "publish" }] }, false],
  ["publish with zero completed reviews", { ...ppub, reviews_completed: 0 }, false],
  ["publish with review_complete false", { ...ppub, checks: { ...checks, review_complete: false } }, false],
  ["publish without reviews_completed", { ...ppub, reviews_completed: undefined }, false],
  ["publish without final criteria", { ...ppub, checks: { ...checks, final_criteria_present: false } }, false],
  ["publish using the archive as a review", { ...ppub, checks: { ...checks, archive_used_as_review: true } }, false],
  ["publish without checks", { ...ppub, checks: undefined }, false],
  ["publish citing only REVIEW-1", { ...ppub, rule_ids: ["REVIEW-1"] }, false],
  ["publish citing only RECO-1", { ...ppub, rule_ids: ["RECO-1"] }, false],
  ["publish with no rule ids", { ...ppub, rule_ids: [] }, false],
  ["unknown rule id", { ...ppub, rule_ids: ["REVIEW-1", "RECO-1", "X-1"] }, false],
  ["publish at confidence 0.91", { ...ppub, confidence: 0.91 }, false],
  ["publish at confidence 0.92", { ...ppub, confidence: 0.92 }, true],
  ["publish with an open recommendation not cited", { ...ppub, open_recommendations_cited: [] }, false],
  ["publish without the cited list", { ...ppub, open_recommendations_cited: undefined }, false],
  ["publish without open_count", { ...ppub, open_count: undefined }, false],
  ["publish with a hint", { ...ppub, revision_hint: "x" }, false],
  ["publish with a hold_reason", { ...ppub, hold_reason: "cannot_decide" }, false],
  ["a cited path with a space", { ...ppub, open_recommendations_cited: [{ ...cite, path: "a name" }] }, false],
  ["a cited ref that is a name", { ...ppub, open_recommendations_cited: [{ ...cite, ref: "Alice" }] }, false],
  ["weight_reason over 300 characters", { ...ppub, open_recommendations_cited: [{ ...cite, weight_reason: "x".repeat(301) }] }, false],
  ["duplicate cited item", { ...ppub, open_count: 2, open_recommendations_cited: [cite, cite] }, false],
  ["speedup_cited true is only a flag", { ...ppub, speedup_cited: true }, true],
  ["needs_revision without a hint", { ...pnr, revision_hint: undefined }, false],
  ["needs_revision without rule ids", { ...pnr, rule_ids: [] }, false],
  ["needs_revision at confidence 0.74", { ...pnr, confidence: 0.74 }, false],
  ["needs_revision with a prior hold", { ...pnr, prior_outcomes: po({ "DP-PRIVACY": "hold" }) }, false],
  ["needs_revision with a prior reject", { ...pnr, prior_outcomes: po({ "DP-LEGALITY": "reject" }) }, false],
  ["needs_revision with a prior route_external", { ...pnr, prior_outcomes: po({ "DP-CRISIS": "route_external" }) }, false],
  ["needs_revision with zero reviews", { ...pnr, reviews_completed: 0 }, false],
  ["needs_revision with an incomplete review", { ...pnr, checks: { ...checks, review_complete: false } }, false],
  ["needs_revision with an open recommendation not cited", { ...pnr, open_recommendations_cited: [] }, false],
  ["reject without a prior reject", { ...prej, prior_outcomes: po() }, false],
  ["reject with a prior hold", { ...prej, prior_outcomes: po({ "DP-LEGALITY": "reject", "DP-PRIVACY": "hold" }) }, false],
  ["reject without prior_outcomes", { ...prej, prior_outcomes: undefined }, false],
  ["reject without rule ids", { ...prej, rule_ids: [] }, false],
  ["reject at confidence 0.91", { ...prej, confidence: 0.91 }, false],
  ["reject with a hold_reason", { ...prej, hold_reason: "cannot_decide" }, false],
  ["route_external without a prior route_external", { ...pext, prior_outcomes: po() }, false],
  ["route_external beside a prior reject", { ...pext, prior_outcomes: po({ "DP-CRISIS": "route_external", "DP-LEGALITY": "reject" }) }, false],
  ["route_external with a prior hold", { ...pext, prior_outcomes: po({ "DP-CRISIS": "route_external", "DP-PRIVACY": "hold" }) }, false],
  ["route_external at confidence 0.89", { ...pext, confidence: 0.89 }, false],
  ["a prior hold with outcome reject", { ...prej, prior_outcomes: po({ "DP-PRIVACY": "hold" }) }, false],
  ["hold without hold_reason", { ...phold, hold_reason: undefined }, false],
  ["hold missing_input without missing_inputs", { ...phold, hold_reason: "missing_input" }, false],
  ["hold missing_input with an unknown input", { ...phold, hold_reason: "missing_input", missing_inputs: ["vibes"] }, false],
  ["hold cannot_decide with missing_inputs", { ...phold, missing_inputs: ["dp_outcomes"] }, false],
  ["hold prior_held without a held prior", { ...phold, hold_reason: "prior_held", prior_outcomes: po() }, false],
  ["hold prior_held without prior_outcomes", { ...phold, hold_reason: "prior_held" }, false],
  ["hold review_incomplete with review_complete true", { ...phold, hold_reason: "review_incomplete", checks }, false],
  ["hold review_incomplete without checks", { ...phold, hold_reason: "review_incomplete" }, false],
  ["unknown hold_reason", { ...phold, hold_reason: "later" }, false],
  ["hold_reason on a non-hold outcome", { ...pnr, hold_reason: "cannot_decide" }, false],
  ["a prior hold with a non-hold outcome", { ...pnr, prior_outcomes: po({ "DP-TONE": "hold" }) }, false],
  ["unknown dp in prior_outcomes", { ...ppub, prior_outcomes: [...po().slice(1), { dp: "DP-MADE-UP", outcome: "publish" }] }, false],
  ["unknown key", { ...ppub, volunteer: "someone" }, false],
  ["reasons item over 600 characters", { ...ppub, reasons: ["x".repeat(601)] }, false],
]);
