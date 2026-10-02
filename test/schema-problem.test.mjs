import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "content-schemas", "problem");
const rd = (p) => JSON.parse(readFileSync(join(DIR, p), "utf8"));
const schema = rd("schema.json");
const messages = rd("messages.en.json");

const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
["version", "pack", "x-ui", "x-guidance", "x-checks", "x-version"].forEach((keyword) => ajv.addKeyword({ keyword }));
const validate = ajv.compile(Object.fromEntries(Object.entries(schema).filter(([k]) => k !== "id")));
const examples = (prefix) => readdirSync(join(DIR, "examples")).filter((f) => f.startsWith(prefix));

// Fails shape, at this pointer. invalid-named-person-in-roles passes shape on purpose: DP-NAMING catches it.
const SHAPE = {
  "invalid-missing-causal-status.json": "/causal_hypothesis",
  "invalid-address-in-place.json": "/place/coarse_area",
  "invalid-filler-everywhere.json": "/condition",
  "invalid-no-final-criteria.json": "/final_acceptance_criteria",
  "invalid-source-bad-category.json": "/sources/0/category",
};
const DP_LEVEL = ["invalid-named-person-in-roles.json"];

test("schema meta-validates through lint", async () => {
  const { lint } = await import("../tools/lint.mjs");
  assert.deepEqual(lint(ROOT).filter((e) => e.includes("content-schemas/problem") || e.includes("limits.yaml")), []);
});

test("valid examples pass (at least 2)", () => {
  const v = examples("valid-");
  assert.ok(v.length >= 2);
  for (const f of v) assert.ok(validate(rd(`examples/${f}`)), `${f}: ${ajv.errorsText(validate.errors)}`);
});

test("invalid examples: shape ones fail at the expected pointer, DP-level ones pass shape", () => {
  const inv = examples("invalid-").sort();
  assert.deepEqual(inv, [...Object.keys(SHAPE), ...DP_LEVEL].sort());
  for (const [f, ptr] of Object.entries(SHAPE)) {
    assert.equal(validate(rd(`examples/${f}`)), false, f);
    assert.ok(validate.errors.some((e) => e.instancePath === ptr), `${f}: expected ${ptr}, got ${validate.errors.map((e) => e.instancePath)}`);
  }
  for (const f of DP_LEVEL) assert.ok(validate(rd(`examples/${f}`)), `${f} must pass shape`);
});

test("required list and order equal section 3 of structured-content.md", (t) => {
  const doc = join(ROOT, "..", "docs", "design", "ai", "structured-content.md");
  if (!existsSync(doc)) return t.skip("superproject docs not present");
  const sec = readFileSync(doc, "utf8").split("## 3.")[1].split("## 4.")[0];
  const names = [...sec.matchAll(/^\| \d+a? \| `([a-z_]+)(?:\[\])?` \|/gm)].map((m) => m[1]);
  assert.equal(names.length, 16);
  assert.deepEqual(schema.required, names);
  assert.deepEqual(Object.keys(schema.properties).slice(0, 16), names);
  assert.deepEqual(names.map((n) => schema.properties[n]["x-ui"].order), names.map((_, i) => i + 1));
  assert.ok(schema.properties.existing_efforts && !schema.required.includes("existing_efforts"));
});

test("every x-ui message id exists and the form has 8 groups", () => {
  const ids = new Set(); const groups = new Set();
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const u = n["x-ui"];
    if (u) { ids.add(u.label_msg); if (u.help_msg) ids.add(u.help_msg); if (u.group) { groups.add(u.group); ids.add(`schema.problem.group.${u.group}`); } }
    Object.values(n).forEach(walk);
  })(schema);
  for (const id of ids) assert.ok(messages[id], `missing message ${id}`);
  assert.equal(groups.size, 8);
});

test("limits_key points at limits.yaml-equal bounds, DPs are as specified", () => {
  const p = schema.properties;
  assert.equal(p.condition["x-guidance"].limits_key, "fields.problem.condition");
  assert.deepEqual([p.final_acceptance_criteria.minItems, p.final_acceptance_criteria.maxItems], [1, 6]);
  assert.deepEqual([p.sources.minItems, p.sources.maxItems], [1, 10]);
  assert.deepEqual([p.observed_facts.minItems, p.observed_facts.maxItems], [1, 10]);
  assert.deepEqual([p.assumptions.minItems, p.assumptions.maxItems], [1, 8]);
  assert.equal(p.causal_hypothesis.properties.statement.minLength, 40);
  assert.equal(p.causal_hypothesis.properties.statement.maxLength, 600);
  assert.ok(p.place["x-checks"].no_address);
  assert.ok(p.responsible_roles.items["x-checks"].roles_only);
  assert.ok(p.sources["x-checks"].dps.includes("DP-SOURCE-TRUST"));
  assert.ok(p.final_acceptance_criteria["x-checks"].dps.includes("DP-CRITERIA"));
  assert.ok(p.evidence_refs["x-checks"].dps.includes("DP-EVIDENCE-TIER"));
  for (const f of ["condition", "affected", "scope", "desired_outcome"]) assert.ok(p[f]["x-checks"].dps.includes("DP-FRAMING"));
});

test("guidance index ids resolve to schema guidance", () => {
  const idx = rd("examples/guidance-index.json");
  assert.equal(idx.length, 3);
  for (const e of idx) { assert.equal(schema.properties[e.field]["x-guidance"].good, e.good); assert.equal(schema.properties[e.field]["x-guidance"].bad, e.bad); }
});

test("no em or en dashes in schema, messages or examples", () => {
  for (const f of ["schema.json", "messages.en.json", ...readdirSync(join(DIR, "examples")).map((e) => `examples/${e}`)]) assert.ok(!/[–—]/.test(readFileSync(join(DIR, f), "utf8")), f);
});
