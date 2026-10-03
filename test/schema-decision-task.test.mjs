import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rd = (p) => JSON.parse(readFileSync(join(ROOT, "content-schemas", p), "utf8"));
const LIMITS = parse(readFileSync(join(ROOT, "limits.yaml"), "utf8"));
const shared = rd("_shared/schema.json").$defs.stage_node.properties;
const KNOWN_DPS = ["DP-PRIVACY", "DP-NAMING", "DP-TONE", "DP-CRISIS", "DP-DUPLICATE", "DP-LEGALITY", "DP-STAGE-PLAN", "DP-CRITERIA", "DP-EVIDENCE-TIER", "DP-VERIFICATION", "DP-STAGE-RESOLUTION", "DP-SOURCE-TRUST", "DP-DECISION-RECORD", "DP-CONTRIB-RELEVANCE"];

const TYPES = {
  decision_record: {
    required: ["stage_choice_ref", "stage_ref", "decision_method", "decider_role", "authority", "rationale", "legal_gate_record", "assumptions", "review_date"],
    dps: ["DP-DECISION-RECORD", "DP-LEGALITY"],
    expect: { "decider-is-named-person": "/decider_role", "missing-stage-choice-ref": "", "no-options-and-no-steps": "", "missing-legal-gate-record": "", "review-date-not-iso": "/review_date", "no-assumptions": "/assumptions" },
  },
  task: {
    required: ["stage_ref", "question_answered", "deliverable", "done_criteria", "owner_role"],
    dps: ["DP-STAGE-RESOLUTION"],
    expect: { "owner-is-named-person": "/owner_role", "no-done-criteria": "/done_criteria", "missing-deliverable": "", "stage-ref-not-slug": "/stage_ref" },
  },
  verification: {
    required: ["stage_ref", "final_criterion_refs", "success_metric_restated", "evidence_refs", "outcomes", "what_the_evidence_does_not_show"],
    dps: ["DP-VERIFICATION", "DP-EVIDENCE-TIER", "DP-SOURCE-TRUST"],
    expect: { "without-criterion-ref": "", "criterion-ref-out-of-range": "/final_criterion_refs/0", "no-evidence-refs": "/evidence_refs", "url-not-http": "/evidence_refs/0/url", "missing-limits-statement": "" },
  },
};
const mk = (schema) => {
  const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
  ["version", "pack", "x-ui", "x-guidance", "x-checks", "x-version"].forEach((keyword) => ajv.addKeyword({ keyword }));
  return ajv.compile(Object.fromEntries(Object.entries(schema).filter(([k]) => k !== "id")));
};
const walk = (n, fn) => { if (Array.isArray(n)) n.forEach((x) => walk(x, fn)); else if (n && typeof n === "object") { fn(n); Object.values(n).forEach((x) => walk(x, fn)); } };
// structure only: drop x-* and annotation keys so inline copies are compared on validation shape
const shape = (n) => Array.isArray(n) ? n.map(shape) : n && typeof n === "object" ? Object.fromEntries(Object.entries(n).filter(([k]) => !k.startsWith("x-") && k !== "readOnly").map(([k, v]) => [k, shape(v)])) : n;

for (const [t, spec] of Object.entries(TYPES)) {
  const schema = rd(`${t}/schema.json`), messages = rd(`${t}/messages.en.json`), validate = mk(schema);
  const files = (p) => readdirSync(join(ROOT, "content-schemas", t, "examples")).filter((f) => f.startsWith(p)).sort();

  test(`${t}: lint clean`, async () => {
    const { lint } = await import("../tools/lint.mjs");
    assert.deepEqual(lint(ROOT).filter((e) => e.includes(t) || e.includes("limits.yaml")), []);
  });

  test(`${t}: valid examples pass, invalid fail where expected`, () => {
    const v = files("valid-"); assert.ok(v.length >= 2);
    for (const f of v) assert.ok(validate(rd(`${t}/examples/${f}`)), `${f}: ${JSON.stringify(validate.errors)}`);
    const inv = files("invalid-"); assert.ok(inv.length >= 3);
    assert.deepEqual(inv, Object.keys(spec.expect).map((k) => `invalid-${k}.json`).sort());
    for (const [k, ptr] of Object.entries(spec.expect)) {
      const f = `invalid-${k}.json`;
      assert.equal(validate(rd(`${t}/examples/${f}`)), false, f);
      assert.ok(validate.errors.some((e) => e.instancePath === ptr), `${f}: expected ${ptr || "root"}, got ${validate.errors.map((e) => e.instancePath || "root")}`);
    }
  });

  test(`${t}: required list, DPs, limits and messages`, (c) => {
    assert.deepEqual(schema.required, spec.required);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.pack, "base@1.0.0"); assert.equal(schema.version, "1.0.0");
    for (const d of spec.dps) assert.ok(schema["x-checks"].dps.includes(d), d);
    walk(schema, (n) => { if (Array.isArray(n["x-checks"]?.dps)) for (const d of n["x-checks"].dps) assert.ok(KNOWN_DPS.includes(d), d); });
    const L = LIMITS.fields[t]; assert.ok(L?.list);
    for (const [k, b] of Object.entries(L)) if (k !== "list") assert.deepEqual([b.min_chars, b.max_chars], [schema.properties[k]["x-guidance"].min_chars, schema.properties[k]["x-guidance"].max_chars], k);
    walk(schema, (n) => { const u = n["x-ui"]; if (u) { assert.ok(messages[u.label_msg], u.label_msg); if (u.help_msg) assert.ok(messages[u.help_msg], u.help_msg); if (u.group) assert.ok(messages[`schema.${t}.group.${u.group}`], u.group); } });
    for (const f of ["schema.json", "messages.en.json", ...files("").map((e) => `examples/${e}`)]) assert.ok(!/[–—]/.test(readFileSync(join(ROOT, "content-schemas", t, f), "utf8")), f);
    const doc = join(ROOT, "..", "docs", "design", "ai", "structured-content.md");
    if (!existsSync(doc)) return c.skip("superproject docs not present");
    assert.ok(readFileSync(doc, "utf8").includes(`\`${t}\``));
  });
}

test("decision_record mirrors stage_choice (drift check)", () => {
  const sc = rd("stage_choice/schema.json"), dr = rd("decision_record/schema.json");
  for (const k of ["stage_ref", "chosen_option_ids", "decision_method", "decider_role", "authority", "rationale", "dissent_notes", "legal_gate_record", "steps"]) assert.deepEqual(shape(dr.properties[k]), shape(sc.properties[k]), k);
  assert.deepEqual(dr.anyOf, sc.anyOf);
  for (const k of ["decider_role", "steps"]) assert.ok(JSON.stringify(dr.properties[k]).includes('"roles_only":true'), k);
  assert.equal(dr["x-checks"].records, "stage_choice");
  assert.equal(dr.properties.stage_choice_ref["x-checks"].ref_to, "stage_choice");
  assert.equal(dr.properties.stage_choice_ref["x-checks"].server_set, true);
  assert.deepEqual(dr.properties.decision_method.enum, shared.decision_method.enum);
});

test("task and verification use the 10-u69 stage and criterion shapes", () => {
  const max = shared.acceptance_criteria.maxItems, se = rd("stage_evidence/schema.json").properties;
  for (const t of Object.keys(TYPES).filter((x) => x !== "decision_record")) assert.equal(rd(`${t}/schema.json`).properties.stage_ref.pattern, shared.name.pattern, t);
  const v = rd("verification/schema.json").properties;
  assert.deepEqual([v.final_criterion_refs.items.minimum, v.final_criterion_refs.items.maximum, v.final_criterion_refs.maxItems], [1, max, max]);
  assert.deepEqual([v.outcomes.items.properties.criterion_ref.minimum, v.outcomes.items.properties.criterion_ref.maximum], [1, max]);
  assert.equal(v.final_criterion_refs["x-checks"].ref_to, "problem.stage_plan.acceptance_criteria");
  assert.deepEqual(shape(v.evidence_refs), shape(se.evidence_refs));
  assert.deepEqual(v.evidence_refs.items.properties.tier_request.enum, se.evidence_refs.items.properties.tier_request.enum);
  assert.equal(rd("task/schema.json").properties.owner_role["x-checks"].roles_only, true);
});

test("verification examples: outcomes cover exactly the final criterion refs", () => {
  for (const f of readdirSync(join(ROOT, "content-schemas/verification/examples")).filter((n) => n.startsWith("valid-"))) {
    const e = rd(`verification/examples/${f}`);
    assert.deepEqual([...e.final_criterion_refs].sort(), e.outcomes.map((o) => o.criterion_ref).sort(), f);
  }
});
