import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rd = (p) => JSON.parse(readFileSync(join(ROOT, "content-schemas", p), "utf8"));
const LIMITS = parse(readFileSync(join(ROOT, "limits.yaml"), "utf8"));
const shared = rd("_shared/schema.json").$defs, bands = rd("_shared/bands.json"), problem = rd("problem/schema.json");
const clone = (x) => JSON.parse(JSON.stringify(x));
const walk = (n, fn) => { if (Array.isArray(n)) n.forEach((x) => walk(x, fn)); else if (n && typeof n === "object") { fn(n); Object.values(n).forEach((x) => walk(x, fn)); } };
const noUi = (n) => { const c = clone(n); walk(c, (o) => delete o["x-ui"]); return c; };

// Rules that JSON Schema cannot say. lint.mjs is not in this unit's writes, so they live here.
// Mirrors x-checks.lint_rule "archive-record-challenge" on archive_record.
export function archiveRecordChallenge(rec) {
  const errs = [], path = rec.executed_path ?? [], ch = rec.challenges ?? [];
  const names = new Set(path.map((s) => s.name));
  for (const s of path) if ((s.outcome === "blocked" || s.outcome === "abandoned") && !ch.some((c) => c.stage === s.name)) errs.push(`ARCHIVE-1: stage ${s.name} is ${s.outcome} with no challenge`);
  for (const c of ch) if (!names.has(c.stage)) errs.push(`challenge stage ${c.stage} is not in executed_path`);
  if (rec.terminal_state === "stuck" && rec.outcome?.unresolved !== true) errs.push("stuck record needs outcome.unresolved true");
  return errs;
}
export function stageDraftCoverage(d) {
  const names = new Set(d.plan.map((s) => s.name)), errs = [];
  if (names.size !== d.plan.length) errs.push("duplicate stage names");
  for (const s of d.plan) { for (const x of s.depends_on ?? []) if (!names.has(x)) errs.push(`${s.name} depends on unknown ${x}`); if (!d.derived_from.some((e) => e.stage === s.name)) errs.push(`stage ${s.name} has no derived_from entry`); }
  for (const e of d.derived_from) if (!names.has(e.stage)) errs.push(`derived_from stage ${e.stage} is not in plan`);
  return errs;
}
const suggestionStages = (p) => { const n = new Set(p.draft_stages.map((s) => s.name)); return p.reuse_fit.legality.filter((l) => !n.has(l.stage)).map((l) => `legality stage ${l.stage} is not in draft_stages`); };

const TYPES = {
  archive_record: {
    required: ["id", "problem_ref", "terminal_state", "source", "snapshot", "context_profile", "executed_path", "options", "evidence_refs", "challenges", "costs", "outcome", "versions", "attribution", "quality"],
    dps: ["DP-ARCHIVE", "DP-PRIVACY"], rule: (r) => archiveRecordChallenge(r),
    expect: { "email-in-option": "/options/0/summary", "blocked-stage-no-challenge": "rule", "missing-license": "/attribution", "stuck-not-unresolved": "/outcome" },
  },
  path_suggestion: {
    required: ["id", "record_ids", "dimensions", "reuse_fit", "draft_stages", "attribution", "state"],
    dps: ["DP-REUSE-FIT", "DP-LEGALITY"], rule: suggestionStages,
    expect: { "unlawful-without-citation": "/reuse_fit/legality/1", "exceeds-without-gap": "/reuse_fit/resource_fit", "state-not-allowed": "/state", "no-attribution": "" },
  },
  stage_draft: {
    required: ["id", "plan", "derived_from", "expires_at", "status"],
    dps: ["DP-STAGE-DRAFT", "DP-STAGE-PLAN"], rule: stageDraftCoverage,
    expect: { "stage-without-derived-from": "rule", "expires-not-utc": "/expires_at", "status-not-allowed": "/status", "stage-name-not-slug": "/plan/0/name" },
  },
};
const mk = (schema) => {
  const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
  ["version", "pack", "x-ui", "x-guidance", "x-checks", "x-version"].forEach((keyword) => ajv.addKeyword({ keyword }));
  return ajv.compile(Object.fromEntries(Object.entries(schema).filter(([k]) => k !== "id")));
};

for (const [t, spec] of Object.entries(TYPES)) {
  const schema = rd(`${t}/schema.json`), messages = rd(`${t}/messages.en.json`), validate = mk(schema);
  const files = (p) => readdirSync(join(ROOT, "content-schemas", t, "examples")).filter((f) => f.startsWith(p)).sort();

  test(`${t}: lint clean`, async () => {
    const { lint } = await import("../tools/lint.mjs");
    assert.deepEqual(lint(ROOT).filter((e) => e.includes(t) || e.includes("limits.yaml")), []);
  });

  test(`${t}: valid examples pass every rule, invalid fail for the stated reason`, () => {
    const v = files("valid-"); assert.ok(v.length >= 2);
    for (const f of v) { const d = rd(`${t}/examples/${f}`); assert.ok(validate(d), `${f}: ${JSON.stringify(validate.errors)}`); assert.deepEqual(spec.rule(d), [], f); }
    const inv = files("invalid-"); assert.ok(inv.length >= 3);
    assert.deepEqual(inv, Object.keys(spec.expect).map((k) => `invalid-${k}.json`).sort());
    for (const [k, ptr] of Object.entries(spec.expect)) {
      const f = `invalid-${k}.json`, d = rd(`${t}/examples/${f}`);
      if (ptr === "rule") { assert.ok(validate(d), `${f}: should be schema valid, the rule rejects it`); assert.ok(spec.rule(d).length > 0, f); continue; }
      assert.equal(validate(d), false, f);
      assert.ok(validate.errors.some((e) => e.instancePath === ptr), `${f}: expected ${ptr || "root"}, got ${validate.errors.map((e) => e.instancePath || "root")}`);
    }
  });

  test(`${t}: required list, DPs, limits, messages, dashes`, () => {
    assert.deepEqual(schema.required, spec.required);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.pack, "base@1.0.0"); assert.equal(schema.version, "1.0.0");
    for (const d of spec.dps) assert.ok(schema["x-checks"].dps.includes(d), d);
    assert.deepEqual(Object.keys(LIMITS.fields[t]), ["list"]);
    assert.deepEqual([LIMITS.fields[t].list.min, LIMITS.fields[t].list.max], [1, problem.properties.stage_plan.maxItems]);
    walk(schema, (n) => { const u = n["x-ui"]; if (u) { assert.ok(messages[u.label_msg], u.label_msg); if (u.help_msg) assert.ok(messages[u.help_msg], u.help_msg); } });
    for (const f of ["schema.json", "messages.en.json", ...files("").map((e) => `examples/${e}`)]) assert.ok(!/[–—]/.test(readFileSync(join(ROOT, "content-schemas", t, f), "utf8")), f);
  });
}

test("inlined copies do not drift from _shared and the problem schema", () => {
  const cp = noUi(problem.properties.context_profile), arcp = noUi(rd("archive_record/schema.json").properties.context_profile);
  delete arcp.required;
  assert.deepEqual(arcp, cp);
  for (const t of Object.keys(TYPES)) {
    const s = rd(`${t}/schema.json`);
    for (const [name, def] of Object.entries(s.$defs)) assert.deepEqual(noUi(def), noUi(shared[name]), `${t} $defs.${name}`);
  }
  assert.deepEqual(Object.keys(rd("archive_record/schema.json").$defs), ["criterion"]);
  for (const t of ["path_suggestion", "stage_draft"]) assert.deepEqual(Object.keys(rd(`${t}/schema.json`).$defs), ["criterion", "stage_node"]);
});

test("bands: archive schemas use the shared scales, export file matches", () => {
  const ar = rd("archive_record/schema.json"), p = ar.properties, ex = rd("archive_record/bands.json");
  const cpp = p.context_profile.properties;
  assert.deepEqual(cpp.population_scale.enum, bands.population_scale);
  assert.deepEqual(cpp.budget_band.properties.band.enum, bands.budget_band);
  assert.deepEqual(cpp.budget_band.properties.currency_class.enum, bands.currency_class);
  assert.deepEqual(cpp.resource_band.properties.people.enum, bands.resource_people);
  assert.deepEqual(cpp.resource_band.properties.in_kind.enum, bands.resource_in_kind);
  assert.deepEqual(cpp.geography.properties.settlement_class.enum, bands.settlement_class);
  assert.deepEqual(cpp.geography.properties.climate_class.enum, bands.climate_class);
  const st = p.executed_path.items.properties;
  assert.deepEqual(st.cost_band.enum, bands.budget_band);
  assert.deepEqual(p.costs.properties.total_band.enum, bands.budget_band);
  assert.deepEqual(p.costs.properties.currency_class.enum, bands.currency_class);
  assert.deepEqual(p.costs.properties.in_kind.enum, bands.resource_in_kind);
  assert.deepEqual(st.duration_band.enum, ex.duration_band);
  assert.deepEqual(p.costs.properties.labour_hours_band.enum, ex.labour_hours_band);
  for (const [k, v] of Object.entries(bands)) if (!k.startsWith("$")) assert.deepEqual(ex[k], v, k);
  assert.deepEqual(ex.cost_band, bands.budget_band);
});

test("archive_record is masked and shares the stage and context shapes", () => {
  const ar = rd("archive_record/schema.json"), node = shared.stage_node.properties;
  assert.equal(ar["x-checks"].masked_refs_only, true);
  assert.equal(ar["x-checks"].lint_rule, "archive-record-challenge");
  assert.equal(ar.properties.attribution.properties.license.default, "CC-BY-4.0");
  assert.deepEqual(ar.properties.attribution.properties.license.enum, ["CC-BY-4.0", "CC0-1.0"]);
  assert.equal(ar.properties.executed_path.items.properties.name.pattern, node.name.pattern);
  assert.deepEqual(ar.properties.challenges.items.properties.kind.enum, ["legal", "resource", "institutional", "evidence", "social", "technical"]);
  assert.deepEqual(ar.properties.executed_path.items.properties.outcome.enum, ["resolved", "skipped", "blocked", "abandoned"]);
  assert.deepEqual(ar.properties.context_profile.properties.category.pattern, problem.properties.context_profile.properties.category.pattern);
  assert.equal(rd("stage_draft/schema.json").properties.plan.maxItems, problem.properties.stage_plan.maxItems);
  assert.deepEqual(rd("path_suggestion/schema.json").properties.state.enum, ["computing", "ready", "stale", "dismissed", "accepted", "used"]);
  // free text carries no email or link, source is simulation in the shipped examples
  for (const f of readdirSync(join(ROOT, "content-schemas/archive_record/examples")).filter((x) => x.startsWith("valid-")))
    assert.equal(rd(`archive_record/examples/${f}`).source, "simulation");
});

test("rules: challenge rule and stage draft coverage", () => {
  const rec = rd("archive_record/examples/valid-stuck-with-challenges.json");
  assert.deepEqual(archiveRecordChallenge(rec), []);
  assert.equal(archiveRecordChallenge({ ...rec, challenges: [] }).length, 2);
  assert.equal(archiveRecordChallenge({ ...rec, outcome: { ...rec.outcome, unresolved: false } }).length, 1);
});
