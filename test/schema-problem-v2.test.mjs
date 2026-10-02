// 10-u69: problem schema parts stage_plan, context_profile, affected_area.
// Layer split: shape (this schema) | cross-references inside a plan (planProblems below, mirrors what validatePlan must do) | graph rules (cycle, required stage reaches the final criteria) = DP-STAGE-PLAN.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CS = join(ROOT, "content-schemas");
const rd = (p) => JSON.parse(readFileSync(join(CS, p), "utf8"));
const schema = rd("problem/schema.json");
const shared = rd("_shared/schema.json");
const bands = rd("_shared/bands.json");
const messages = rd("problem/messages.en.json");
const ex = (n) => rd(`problem/examples/${n}`);

const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
["version", "pack", "x-ui", "x-guidance", "x-checks", "x-version"].forEach((k) => ajv.addKeyword({ keyword: k }));
const validate = ajv.compile(Object.fromEntries(Object.entries(schema).filter(([k]) => k !== "id")));
const planOnly = ajv.compile({ type: "object", required: ["stage_plan"], properties: { stage_plan: schema.properties.stage_plan }, $defs: schema.$defs });

// Cross-reference problems of a plan (not expressible in JSON Schema).
function planProblems(plan) {
  const out = []; const names = plan.map((s) => s.name);
  names.forEach((n, i) => { if (names.indexOf(n) !== i) out.push(`duplicate name ${n}`); });
  for (const s of plan) for (const d of s.depends_on ?? []) { if (!names.includes(d)) out.push(`${s.name} depends on unknown ${d}`); if (d === s.name) out.push(`${s.name} depends on itself`); }
  return out;
}
function hasCycle(plan) {
  const dep = new Map(plan.map((s) => [s.name, s.depends_on ?? []])); const state = new Map();
  const visit = (n) => { if (state.get(n) === 1) return true; if (state.get(n) === 2 || !dep.has(n)) return false; state.set(n, 1); const bad = dep.get(n).some(visit); state.set(n, 2); return bad; };
  return [...dep.keys()].some(visit);
}

test("lint passes for problem, _shared and limits", async () => {
  const { lint } = await import("../tools/lint.mjs");
  assert.deepEqual(lint(ROOT).filter((e) => /problem|_shared|limits/.test(e)), []);
});

test("required list is unchanged and the three parts are optional", () => {
  assert.equal(schema.required.length, 16);
  for (const k of ["stage_plan", "context_profile", "affected_area"]) { assert.ok(schema.properties[k]); assert.ok(!schema.required.includes(k)); }
  assert.deepEqual(["stage_plan", "context_profile", "affected_area"].map((k) => schema.properties[k]["x-ui"].order), [18, 19, 20]);
  assert.equal(schema.properties.stage_plan["x-ui"].group, "plan");
  assert.equal(schema.properties.context_profile["x-ui"].group, "context");
  assert.ok(messages["schema.problem.group.plan"] && messages["schema.problem.group.context"]);
});

test("inlined fragments equal _shared and bands.json", () => {
  assert.deepEqual(schema.$defs.criterion, shared.$defs.criterion);
  assert.deepEqual(schema.$defs.stage_node, shared.$defs.stage_node);
  const cp = schema.properties.context_profile.properties;
  assert.deepEqual(cp.population_scale.enum, bands.population_scale);
  assert.deepEqual(cp.budget_band.properties.band.enum, bands.budget_band);
  assert.deepEqual(cp.budget_band.properties.currency_class.enum, bands.currency_class);
  assert.deepEqual(cp.resource_band.properties.people.enum, bands.resource_people);
  assert.deepEqual(cp.resource_band.properties.in_kind.enum, bands.resource_in_kind);
  assert.deepEqual(cp.geography.properties.settlement_class.enum, bands.settlement_class);
  assert.deepEqual(cp.geography.properties.climate_class.enum, bands.climate_class);
});

test("valid examples and both templates pass shape", () => {
  for (const f of ["valid-with-parallel-stage-plan.json", "valid-with-classic-5.json"]) { assert.ok(validate(ex(f)), `${f}: ${ajv.errorsText(validate.errors)}`); assert.deepEqual(planProblems(ex(f).stage_plan), []); assert.ok(!hasCycle(ex(f).stage_plan)); }
  for (const f of ["template-classic-5.json", "template-one-stage.json"]) { const t = ex(f); assert.ok(planOnly(t), `${f}: ${ajv.errorsText(planOnly.errors)}`); assert.deepEqual(planProblems(t.stage_plan), []); assert.ok(!hasCycle(t.stage_plan)); }
  assert.equal(ex("template-classic-5.json").stage_plan.length, 5);
  assert.equal(ex("template-one-stage.json").stage_plan.length, 1);
});

test("invalid examples fail at the layer and place they should", () => {
  const shape = { "invalid-stage-no-criteria.json": "/stage_plan/0/acceptance_criteria", "invalid-geography-street-address.json": "/context_profile/geography/region" };
  for (const [f, ptr] of Object.entries(shape)) { assert.equal(validate(ex(f)), false, f); assert.ok(validate.errors.some((e) => e.instancePath === ptr), `${f}: ${validate.errors.map((e) => e.instancePath)}`); }
  // cross reference layer: shape-valid, planProblems reports it
  for (const [f, re] of [["invalid-stage-depends-on-unknown.json", /unknown no_such_stage/], ["invalid-stage-duplicate-name.json", /duplicate name map_outages/]]) {
    assert.ok(validate(ex(f)), `${f} must pass shape`); assert.match(planProblems(ex(f).stage_plan).join(";"), re);
  }
  // graph layer: DP-STAGE-PLAN / validatePlan
  const cyc = ex("invalid-stage-cycle.json"); assert.ok(validate(cyc)); assert.deepEqual(planProblems(cyc.stage_plan), []); assert.ok(hasCycle(cyc.stage_plan));
  // taxonomy layer: shape-valid until archive.taxonomy exists (10-u66), then the lint checks the id
  const tax = ex("invalid-context-unknown-taxonomy-id.json"); assert.ok(validate(tax));
  assert.equal(schema.properties.context_profile.properties.problem_type["x-checks"].taxonomy, "archive.taxonomy");
});

test("the files on disk match the invalid list", () => {
  const got = readdirSync(join(CS, "problem/examples")).filter((f) => /^invalid-(stage|context|geography)-/.test(f)).sort();
  assert.deepEqual(got, ["invalid-context-unknown-taxonomy-id.json", "invalid-geography-street-address.json", "invalid-stage-cycle.json", "invalid-stage-depends-on-unknown.json", "invalid-stage-duplicate-name.json", "invalid-stage-no-criteria.json"]);
});

test("context_profile: unknown allowed, private bands, readonly legal stack, no precise place", () => {
  const cp = schema.properties.context_profile; const p = cp.properties;
  assert.ok(validate({ ...ex("valid-minimal.json"), context_profile: {} }));
  assert.ok(validate({ ...ex("valid-minimal.json"), context_profile: { geography: { country: "unknown", region: "unknown", settlement_class: "unknown", climate_class: "unknown" } } }));
  assert.ok(p.budget_band["x-checks"].private_until_publication && p.resource_band["x-checks"].private_until_publication);
  assert.equal(p.legal_stack["x-ui"].widget, "readonly");
  assert.equal(cp.additionalProperties, false);
  assert.equal(p.geography.additionalProperties, false);
  for (const bad of ["14 Alder Lane", "Region 12345", "North #4", "https://x/y"]) assert.ok(!new RegExp(p.geography.properties.region.pattern, "u").test(bad), bad);
  assert.ok(new RegExp(p.geography.properties.region.pattern, "u").test("District 9"));
  for (const k of ["problem_type", "category", "population_scale", "language"]) assert.ok(p[k]["x-checks"].allow_unknown, k);
});

test("stage_plan: DPs, widget, defaults and CRITERIA-1 stay on the final criteria", () => {
  const sp = schema.properties.stage_plan;
  assert.equal(sp["x-ui"].widget, "stage_plan");
  assert.ok(sp["x-checks"].dps.includes("DP-STAGE-PLAN") && sp["x-checks"].dps.includes("DP-CRITERIA"));
  const n = shared.$defs.stage_node.properties;
  assert.deepEqual([n.decision_method.default, n.required.default, n.needs_choice.default, n.auto_start.default, n.depends_on.default], ["poster_after_input", true, true, true, []]);
  assert.deepEqual(shared.$defs.stage_node.required, ["name", "goal", "acceptance_criteria"]);
  assert.equal(n.acceptance_criteria.minItems, 1);
  assert.deepEqual(shared.$defs.criterion.required, ["statement", "measure"]);
});

test("affected_area is a reference only", () => {
  const a = schema.properties.affected_area;
  assert.equal(a["x-ui"].widget, "area_picker");
  assert.ok(a["x-checks"].reviewable);
  assert.deepEqual(Object.keys(a.properties), ["area_version"]);
  assert.equal(a.additionalProperties, false);
  assert.ok(validate({ ...ex("valid-minimal.json"), affected_area: { area_version: 2 } }));
  assert.equal(validate({ ...ex("valid-minimal.json"), affected_area: { area_version: 1, polygon: { type: "Polygon", coordinates: [] } } }), false);
});

test("every new message id exists and no dashes", () => {
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const u = n["x-ui"]; if (u) for (const id of [u.label_msg, u.help_msg]) if (id) assert.ok(messages[id], `missing ${id}`);
    Object.values(n).forEach(walk);
  })([schema, shared]);
  for (const f of ["_shared/schema.json", "_shared/bands.json"]) assert.ok(!/[–—]/.test(readFileSync(join(CS, f), "utf8")));
});
