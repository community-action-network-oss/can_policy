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
const shared = rd("_shared/schema.json").$defs, bands = rd("_shared/bands.json");

const TYPES = {
  stage_option: {
    required: ["stage_ref", "option_statement", "mechanism", "responsible_role", "authority_and_legal_basis", "cost_estimate", "how_it_meets_stage_criteria", "risks_and_rights_impact", "lawful_alternatives", "assumptions"],
    dps: ["DP-LEGALITY", "DP-CONTRIB-RELEVANCE"],
    expect: { "missing-how-it-meets": "", "stage-ref-not-slug": "/stage_ref", "criterion-ref-out-of-range": "/how_it_meets_stage_criteria/0/criterion_ref", "no-lawful-alternative": "/lawful_alternatives", "cost-band-unknown-value": "/cost_estimate/band" },
  },
  stage_choice: {
    required: ["stage_ref", "decision_method", "decider_role", "authority", "rationale"],
    dps: ["DP-DECISION-RECORD", "DP-LEGALITY"],
    expect: { "decider-is-named-person": "/decider_role", "no-options-and-no-steps": "", "decision-method-not-allowed": "/decision_method", "step-without-done-criterion": "/steps/0" },
  },
  stage_evidence: {
    required: ["stage_ref", "criterion_ref", "evidence_refs", "observation_date", "outcome_statement", "what_the_evidence_does_not_show"],
    dps: ["DP-STAGE-RESOLUTION", "DP-EVIDENCE-TIER", "DP-SOURCE-TRUST"],
    expect: { "criterion-ref-missing": "", "no-evidence-refs": "/evidence_refs", "url-not-http": "/evidence_refs/0/url", "date-not-iso": "/observation_date", "missing-limits": "" },
  },
};
const mk = (schema) => {
  const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
  ["version", "pack", "x-ui", "x-guidance", "x-checks", "x-version"].forEach((keyword) => ajv.addKeyword({ keyword }));
  return ajv.compile(Object.fromEntries(Object.entries(schema).filter(([k]) => k !== "id")));
};
const walk = (n, fn) => { if (Array.isArray(n)) n.forEach((x) => walk(x, fn)); else if (n && typeof n === "object") { fn(n); Object.values(n).forEach((x) => walk(x, fn)); } };

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
    assert.equal(schema.pack, "base@1.0.0"); assert.equal(schema.version, t === "stage_choice" ? "2.0.0" : "1.0.0");
    for (const d of spec.dps) assert.ok(schema["x-checks"].dps.includes(d), d);
    // limits keys equal top-level x-guidance and one list key exists
    const L = LIMITS.fields[t]; assert.ok(L?.list);
    for (const [k, b] of Object.entries(L)) if (k !== "list") assert.deepEqual([b.min_chars, b.max_chars], [schema.properties[k]["x-guidance"].min_chars, schema.properties[k]["x-guidance"].max_chars], k);
    // every message id resolves, every group has a label
    walk(schema, (n) => { const u = n["x-ui"]; if (u) { assert.ok(messages[u.label_msg], u.label_msg); if (u.help_msg) assert.ok(messages[u.help_msg], u.help_msg); if (u.group) assert.ok(messages[`schema.${t}.group.${u.group}`], u.group); } });
    for (const f of ["schema.json", "messages.en.json", ...files("").map((e) => `examples/${e}`)]) assert.ok(!/[–—]/.test(readFileSync(join(ROOT, "content-schemas", t, f), "utf8")), f);
    const doc = join(ROOT, "..", "docs", "design", "ai", "structured-content.md");
    if (!existsSync(doc)) return c.skip("superproject docs not present");
    assert.ok(readFileSync(doc, "utf8").includes(`| \`${t}\` |`));
  });
}

test("stage refs and criterion refs point at fields of the 10-u69 stage shape", () => {
  const node = shared.stage_node.properties;
  for (const t of Object.keys(TYPES)) assert.equal(rd(`${t}/schema.json`).properties.stage_ref.pattern, node.name.pattern, t);
  const max = node.acceptance_criteria.maxItems, ev = rd("stage_evidence/schema.json").properties.criterion_ref;
  assert.deepEqual([ev.minimum, ev.maximum], [1, max]);
  const opt = rd("stage_option/schema.json").properties;
  const oc = opt.how_it_meets_stage_criteria.items.properties.criterion_ref;
  assert.deepEqual([oc.minimum, oc.maximum], [1, max]);
  assert.deepEqual([opt.how_it_meets_stage_criteria.minItems, opt.how_it_meets_stage_criteria.maxItems], [1, max]);
  assert.equal(opt.how_it_meets_stage_criteria["x-checks"].dps.includes("DP-STAGE-RESOLUTION"), true);
  assert.equal(ev["x-checks"].ref_to, "problem.stage_plan.acceptance_criteria");
  assert.deepEqual(rd("stage_choice/schema.json").properties.decision_method.enum, node.decision_method.enum);
  assert.deepEqual(opt.cost_estimate.properties.band.enum, bands.budget_band);
  assert.equal(rd("problem/schema.json").properties.stage_plan.items.$ref, "#/$defs/stage_node");
});

test("stage_choice: chosen options or steps, decider is a role string only", () => {
  const s = rd("stage_choice/schema.json"), p = s.properties;
  assert.equal(p.decider_role["x-checks"].roles_only, true);
  assert.equal(p.steps.items.properties.owner_role["x-checks"].roles_only, true);
  assert.equal(s.anyOf.length, 2);
  assert.equal(p.legal_gate_record.readOnly, true);
  assert.equal(p.legal_gate_record["x-checks"].server_set, true);
  assert.deepEqual(p.legal_gate_record.required, ["constraint_checked", "source_ref", "layer", "result"]);
  assert.deepEqual(p.steps.items.required, ["step", "owner_role", "done_criterion"]);
});

test("stage_evidence: url widget forbids uploads of people", () => {
  const u = rd("stage_evidence/schema.json").properties.evidence_refs.items.properties.url;
  assert.equal(u["x-ui"].widget, "evidence_url");
  assert.equal(u["x-checks"].no_uploads_of_people, true);
});

test("stage_choice: a body without legal_gate_record validates (server-set field)", () => {
  const ex = rd("stage_choice/examples/valid-no-legal-gate-record.json");
  assert.equal("legal_gate_record" in ex, false);
  const v = mk(rd("stage_choice/schema.json"));
  assert.ok(v(ex), JSON.stringify(v.errors));
});
