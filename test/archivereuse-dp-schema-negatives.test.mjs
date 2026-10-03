import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

// 10-u65: unsafe DP-ARCHIVE, DP-REUSE-FIT and DP-STAGE-DRAFT outputs must be unrepresentable. Compiled strict, like can_server.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (dp) => new Ajv2020({ strict: true, strictTypes: true, strictRequired: true, allErrors: true })
  .compile(JSON.parse(readFileSync(join(ROOT, "decision-points", dp, "schema.json"), "utf8")));
const run = (name, validate, cases) => test(name, () => {
  for (const [label, out, ok] of cases) {
    const clean = Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
    assert.equal(validate(clean), ok, `${label}: ${JSON.stringify(validate.errors?.slice(0, 2))}`);
  }
});
const hold = { outcome: "hold", rule_ids: [], confidence: 0.4, reasons: ["r"], hold_reason: "cannot_decide" };
const holdCases = (v) => [
  ["valid hold", v, true],
  ["valid hold missing_input", { ...v, hold_reason: "missing_input", missing_inputs: ["jurisdiction"] }, true],
  ["hold without hold_reason", { ...v, hold_reason: undefined }, false],
  ["hold missing_input without missing_inputs", { ...v, hold_reason: "missing_input" }, false],
  ["hold missing_input with an unknown input", { ...v, hold_reason: "missing_input", missing_inputs: ["vibes"] }, false],
  ["hold cannot_decide with missing_inputs", { ...v, missing_inputs: ["jurisdiction"] }, false],
  ["hold_reason on a publish outcome", { ...v, outcome: "publish" }, false],
  ["unknown hold_reason", { ...v, hold_reason: "conflict" }, false],
  ["reject outcome", { ...v, outcome: "reject" }, false],
  ["route_external outcome", { ...v, outcome: "route_external" }, false],
  ["escalate_human outcome", { ...v, outcome: "escalate_human" }, false],
  ["unknown key", { ...v, auto_publish: true }, false],
  ["reasons item over 600 characters", { ...v, reasons: ["x".repeat(601)] }, false],
  ["unknown rule id", { ...v, rule_ids: ["X-1"] }, false],
];

// ---- DP-ARCHIVE
const apub = { outcome: "publish", rule_ids: ["ARCHIVE-1"], confidence: 0.95, reasons: ["r"], residual_personal_data: false, failures_explained: true, blocked_explained: true };
const anr = { outcome: "needs_revision", rule_ids: ["ARCHIVE-1"], confidence: 0.8, reasons: ["r"], revision_hint: "Fix c-1.", residual_personal_data: false, failures_explained: false, missing: [{ field: "failure_reasons", ref: "c-1", hint: "c-1 gives no reason." }] };
const ahold = { ...hold };
run("DP-ARCHIVE schema negatives", load("DP-ARCHIVE"), [
  ["valid publish", apub, true],
  ["valid needs_revision", anr, true],
  ["valid residual hold", { ...ahold, hold_reason: "residual_personal_data", residual_personal_data: true, rule_ids: ["ARCHIVE-1"] }, true],
  ...holdCases(ahold),
  ["publish without ARCHIVE-1", { ...apub, rule_ids: [] }, false],
  ["publish at confidence 0.89", { ...apub, confidence: 0.89 }, false],
  ["publish at confidence 0.9", { ...apub, confidence: 0.9 }, true],
  ["publish with residual personal data", { ...apub, residual_personal_data: true }, false],
  ["publish without residual_personal_data", { ...apub, residual_personal_data: undefined }, false],
  ["publish with failures not explained", { ...apub, failures_explained: false }, false],
  ["publish with blocked stages not explained", { ...apub, blocked_explained: false }, false],
  ["publish without failures_explained", { ...apub, failures_explained: undefined }, false],
  ["publish with missing items", { ...apub, missing: anr.missing }, false],
  ["publish with a hint", { ...apub, revision_hint: "x" }, false],
  ["needs_revision without missing", { ...anr, missing: undefined }, false],
  ["needs_revision with empty missing", { ...anr, missing: [] }, false],
  ["needs_revision without a hint", { ...anr, revision_hint: undefined }, false],
  ["needs_revision at confidence 0.74", { ...anr, confidence: 0.74 }, false],
  ["needs_revision with residual personal data", { ...anr, residual_personal_data: true }, false],
  ["needs_revision without residual_personal_data", { ...anr, residual_personal_data: undefined }, false],
  ["missing item with an unknown field", { ...anr, missing: [{ field: "vibes", hint: "h" }] }, false],
  ["missing item with an email in the hint", { ...anr, missing: [{ field: "challenges", hint: "write to a@example.org" }] }, false],
  ["missing item with a link in the hint", { ...anr, missing: [{ field: "challenges", hint: "see https://x.example.org" }] }, false],
  ["missing item with a name as ref", { ...anr, missing: [{ field: "challenges", ref: "Alice Example", hint: "h" }] }, false],
  ["duplicate missing item", { ...anr, missing: [anr.missing[0], anr.missing[0]] }, false],
  ["missing hint over 300 characters", { ...anr, missing: [{ field: "challenges", hint: "x".repeat(301) }] }, false],
  ["hold with missing items", { ...ahold, missing: anr.missing }, false],
  ["residual true on a publish outcome", { ...apub, residual_personal_data: true, hold_reason: "residual_personal_data" }, false],
  ["residual true with hold_reason cannot_decide", { ...ahold, residual_personal_data: true }, false],
  ["residual true with outcome needs_revision", { ...anr, residual_personal_data: true, hold_reason: "residual_personal_data" }, false],
  ["hold_reason residual with residual false", { ...ahold, hold_reason: "residual_personal_data", residual_personal_data: false }, false],
  ["hold_reason residual without residual_personal_data", { ...ahold, hold_reason: "residual_personal_data" }, false],
]);

// ---- DP-REUSE-FIT
const flags = { auto_adopt: false, review_still_required: true, archive_used_as_review: false };
const rpub = { outcome: "publish", rule_ids: ["REUSE-CONTEXT-1", "REUSE-CREDIT-1"], confidence: 0.9, reasons: ["r"], adaptations: [{ stage_ref: "s-2", kind: "scale_down", reason: "One week fits the helpers here." }], unusable_stages: ["s-3"], differences_shown: ["d-1"], credited_sources: ["r-1"], ...flags };
const rnr = { outcome: "needs_revision", rule_ids: ["REUSE-CONTEXT-1"], confidence: 0.8, reasons: ["r"], revision_hint: "Add your helpers to the draft.", unusable_stages: [], differences_shown: [], credited_sources: ["r-1"], ...flags };
const rhold = { ...hold, hold_reason: "legality_unchecked" };
run("DP-REUSE-FIT schema negatives", load("DP-REUSE-FIT"), [
  ["valid publish", rpub, true],
  ["valid publish with empty lists", { ...rpub, adaptations: [], unusable_stages: [], differences_shown: [] }, true],
  ["valid publish with an analogue", { ...rpub, adaptations: [{ stage_ref: "s-3", kind: "substitute", reason: "Use the supplied analogue.", analogue_ref: "a-1" }] }, true],
  ["valid needs_revision", rnr, true],
  ["valid legality_unchecked hold", rhold, true],
  ...holdCases({ ...hold }),
  ["publish with only REUSE-CONTEXT-1", { ...rpub, rule_ids: ["REUSE-CONTEXT-1"] }, false],
  ["publish with only REUSE-CREDIT-1", { ...rpub, rule_ids: ["REUSE-CREDIT-1"] }, false],
  ["publish with REUSE-NOBLOCK-1", { ...rpub, rule_ids: ["REUSE-CONTEXT-1", "REUSE-CREDIT-1", "REUSE-NOBLOCK-1"] }, false],
  ["publish at confidence 0.84", { ...rpub, confidence: 0.84 }, false],
  ["publish without credited_sources", { ...rpub, credited_sources: undefined }, false],
  ["publish with empty credited_sources", { ...rpub, credited_sources: [] }, false],
  ["publish without differences_shown", { ...rpub, differences_shown: undefined }, false],
  ["publish without unusable_stages", { ...rpub, unusable_stages: undefined }, false],
  ["publish without adaptations", { ...rpub, adaptations: undefined }, false],
  ["publish with auto_adopt true", { ...rpub, auto_adopt: true }, false],
  ["publish without auto_adopt", { ...rpub, auto_adopt: undefined }, false],
  ["publish with review not required", { ...rpub, review_still_required: false }, false],
  ["publish with the archive used as review", { ...rpub, archive_used_as_review: true }, false],
  ["publish without archive_used_as_review", { ...rpub, archive_used_as_review: undefined }, false],
  ["publish with a hint", { ...rpub, revision_hint: "x" }, false],
  ["adaptation with an unknown kind", { ...rpub, adaptations: [{ stage_ref: "s-1", kind: "mark_lawful", reason: "Everything is lawful." }] }, false],
  ["adaptation without a reason", { ...rpub, adaptations: [{ stage_ref: "s-1", kind: "drop_step" }] }, false],
  ["adaptation with a short reason", { ...rpub, adaptations: [{ stage_ref: "s-1", kind: "drop_step", reason: "no" }] }, false],
  ["adaptation with an email", { ...rpub, adaptations: [{ stage_ref: "s-1", kind: "drop_step", reason: "Ask a@example.org instead." }] }, false],
  ["adaptation with a link", { ...rpub, adaptations: [{ stage_ref: "s-1", kind: "drop_step", reason: "See https://x.example.org for more." }] }, false],
  ["adaptation with a name as stage_ref", { ...rpub, adaptations: [{ stage_ref: "Alice Example", kind: "drop_step", reason: "Because of her." }] }, false],
  ["adaptation with a free text analogue", { ...rpub, adaptations: [{ stage_ref: "s-3", kind: "substitute", reason: "Use the lawful analogue.", analogue_ref: "the road act article 4" }] }, false],
  ["adaptation with a legality verdict key", { ...rpub, adaptations: [{ stage_ref: "s-3", kind: "substitute", reason: "Use the analogue.", legality: "lawful" }] }, false],
  ["a legality key at top level", { ...rpub, legality: "lawful" }, false],
  ["duplicate adaptation", { ...rpub, adaptations: [rpub.adaptations[0], rpub.adaptations[0]] }, false],
  ["duplicate credited source", { ...rpub, credited_sources: ["r-1", "r-1"] }, false],
  ["duplicate difference ref", { ...rpub, differences_shown: ["d-1", "d-1"] }, false],
  ["free text difference ref", { ...rpub, differences_shown: ["geography"] }, false],
  ["more than 5 credited sources", { ...rpub, credited_sources: ["r-1", "r-2", "r-3", "r-4", "r-5", "r-6"] }, false],
  ["needs_revision without a hint", { ...rnr, revision_hint: undefined }, false],
  ["needs_revision with adaptations", { ...rnr, adaptations: [] }, false],
  ["needs_revision without REUSE-CONTEXT-1", { ...rnr, rule_ids: ["REUSE-CREDIT-1"] }, false],
  ["needs_revision at confidence 0.74", { ...rnr, confidence: 0.74 }, false],
  ["needs_revision with auto_adopt true", { ...rnr, auto_adopt: true }, false],
  ["hold with adaptations", { ...rhold, adaptations: [] }, false],
  ["hold with credited_sources", { ...rhold, credited_sources: ["r-1"] }, false],
  ["hold with auto_adopt true", { ...rhold, auto_adopt: true }, false],
  ["hold with archive_used_as_review true", { ...rhold, archive_used_as_review: true }, false],
]);

// ---- DP-STAGE-DRAFT
const dflags = { draft_only: true, review_still_required: true, archive_used_as_review: false };
const stage = { name: "ask_roads_office", goal: "Ask the roads office for a lit crossing.", criteria: [{ statement: "The roads office has replied in writing.", measure: "A dated written reply is attached." }], derived_from: ["t-1"], covers: ["f-1"], decision_method: "poster_after_input", depends_on: [], auto_start: true };
const dpub = { outcome: "publish", rule_ids: ["REUSE-CREDIT-1", "REUSE-NOBLOCK-1"], confidence: 0.9, reasons: ["r"], draft_plan: [stage], credited_suggestions: ["g-1"], skipped_source_stages: [], uncovered_final_criteria: [], ...dflags };
const dnr = { outcome: "needs_revision", rule_ids: ["REUSE-CREDIT-1"], confidence: 0.8, reasons: ["r"], revision_hint: "Add a stage for f-2.", uncovered_final_criteria: ["f-2"], skipped_source_stages: ["t-2"], ...dflags };
const dhold = { ...hold, hold_reason: "legality_unchecked" };
const withStage = (o) => ({ ...dpub, draft_plan: [{ ...stage, ...o }] });
run("DP-STAGE-DRAFT schema negatives", load("DP-STAGE-DRAFT"), [
  ["valid publish", dpub, true],
  ["valid publish without optional keys", { ...dpub, draft_plan: [{ name: "ask_roads_office", goal: stage.goal, criteria: stage.criteria, derived_from: ["t-1"], covers: [] }] }, true],
  ["valid needs_revision", dnr, true],
  ["valid legality_unchecked hold", dhold, true],
  ...holdCases({ ...hold }),
  ["publish with only REUSE-CREDIT-1", { ...dpub, rule_ids: ["REUSE-CREDIT-1"] }, false],
  ["publish with only REUSE-NOBLOCK-1", { ...dpub, rule_ids: ["REUSE-NOBLOCK-1"] }, false],
  ["publish with REUSE-CONTEXT-1", { ...dpub, rule_ids: ["REUSE-CREDIT-1", "REUSE-NOBLOCK-1", "REUSE-CONTEXT-1"] }, false],
  ["publish at confidence 0.84", { ...dpub, confidence: 0.84 }, false],
  ["publish without draft_plan", { ...dpub, draft_plan: undefined }, false],
  ["publish with empty draft_plan", { ...dpub, draft_plan: [] }, false],
  ["publish without credited_suggestions", { ...dpub, credited_suggestions: undefined }, false],
  ["publish with empty credited_suggestions", { ...dpub, credited_suggestions: [] }, false],
  ["publish without skipped_source_stages", { ...dpub, skipped_source_stages: undefined }, false],
  ["publish without uncovered_final_criteria", { ...dpub, uncovered_final_criteria: undefined }, false],
  ["publish with an uncovered final criterion", { ...dpub, uncovered_final_criteria: ["f-2"] }, false],
  ["publish with draft_only false", { ...dpub, draft_only: false }, false],
  ["publish with review not required", { ...dpub, review_still_required: false }, false],
  ["publish with the archive used as review", { ...dpub, archive_used_as_review: true }, false],
  ["publish without review_still_required", { ...dpub, review_still_required: undefined }, false],
  ["publish with a hint", { ...dpub, revision_hint: "x" }, false],
  ["stage without derived_from (credit dropped)", withStage({ derived_from: undefined }), false],
  ["stage with empty derived_from", withStage({ derived_from: [] }), false],
  ["stage with a free text derived_from", withStage({ derived_from: ["the Northvale record"] }), false],
  ["stage without covers", withStage({ covers: undefined }), false],
  ["stage without criteria", withStage({ criteria: undefined }), false],
  ["stage with empty criteria", withStage({ criteria: [] }), false],
  ["criterion without a measure", withStage({ criteria: [{ statement: "The roads office has replied in writing." }] }), false],
  ["criterion with an email", withStage({ criteria: [{ statement: "Write to a@example.org about it.", measure: "A dated written reply is attached." }] }), false],
  ["goal with a link", withStage({ goal: "Follow https://x.example.org to ask for a crossing." }), false],
  ["goal over 300 characters", withStage({ goal: "x".repeat(301) }), false],
  ["stage name with capitals", withStage({ name: "Ask Roads" }), false],
  ["stage name too short", withStage({ name: "a" }), false],
  ["unknown decision method", withStage({ decision_method: "auto_decide" }), false],
  ["auto_start as a string", withStage({ auto_start: "true" }), false],
  ["stage with an unknown key", withStage({ publish_now: true }), false],
  ["stage with a status key", withStage({ status: "started" }), false],
  ["duplicate credited suggestion", { ...dpub, credited_suggestions: ["g-1", "g-1"] }, false],
  ["free text skipped stage", { ...dpub, skipped_source_stages: ["stage two"] }, false],
  ["needs_revision without a hint", { ...dnr, revision_hint: undefined }, false],
  ["needs_revision with a draft_plan", { ...dnr, draft_plan: [stage] }, false],
  ["needs_revision with credited_suggestions", { ...dnr, credited_suggestions: ["g-1"] }, false],
  ["needs_revision without rule ids", { ...dnr, rule_ids: [] }, false],
  ["needs_revision at confidence 0.74", { ...dnr, confidence: 0.74 }, false],
  ["needs_revision with review not required", { ...dnr, review_still_required: false }, false],
  ["needs_revision without uncovered_final_criteria", { ...dnr, uncovered_final_criteria: undefined }, false],
  ["hold with a draft_plan", { ...dhold, draft_plan: [stage] }, false],
  ["hold with credited_suggestions", { ...dhold, credited_suggestions: ["g-1"] }, false],
  ["hold with archive_used_as_review true", { ...dhold, archive_used_as_review: true }, false],
]);
