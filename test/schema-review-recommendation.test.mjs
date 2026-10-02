import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";
import { lint } from "../tools/lint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rd = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const T = "review_recommendation";
const schema = rd(`content-schemas/${T}/schema.json`), messages = rd(`content-schemas/${T}/messages.en.json`), problem = rd("content-schemas/problem/schema.json");
const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
["version", "pack", "x-ui", "x-guidance", "x-checks", "x-version"].forEach((keyword) => ajv.addKeyword({ keyword }));
const validate = ajv.compile(Object.fromEntries(Object.entries(schema).filter(([k]) => k !== "id")));
const files = (p) => readdirSync(join(ROOT, "content-schemas", T, "examples")).filter((f) => f.startsWith(p)).sort();
const ex = (f) => rd(`content-schemas/${T}/examples/${f}`);
const walk = (n, fn) => { if (Array.isArray(n)) n.forEach((x) => walk(x, fn)); else if (n && typeof n === "object") { fn(n); Object.values(n).forEach((x) => walk(x, fn)); } };

test("lint clean", () => assert.deepEqual(lint(ROOT).filter((e) => e.includes(T)), []));

test("valid examples pass, invalid fail for the stated reason", () => {
  assert.ok(files("valid-").length >= 2);
  for (const f of files("valid-")) assert.ok(validate(ex(f)), `${f}: ${JSON.stringify(validate.errors)}`);
  const expect = { "accepted-without-resolution-reason": "", "path-not-in-problem": "/path", "reason-too-short": "/reason" };
  for (const [k, ptr] of Object.entries(expect)) {
    assert.equal(validate(ex(`invalid-${k}.json`)), false, k);
    assert.ok(validate.errors.some((e) => e.instancePath === ptr), `${k}: ${JSON.stringify(validate.errors)}`);
  }
  // shape passes on purpose: the named person is caught by DP-NAMING, not by the schema
  assert.ok(validate(ex("invalid-names-a-person.json")), "names-a-person is a shape-valid example that fails DP-NAMING");
  assert.deepEqual(files("invalid-").length, 4);
});

test("required list, always-on DPs only, messages, no dashes", (c) => {
  assert.deepEqual(schema.required, ["problem_ref", "path", "recommendation", "reason", "status"]);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.pack, "base@1.0.0"); assert.equal(schema.version, "1.0.0");
  const ALWAYS = ["DP-CRISIS", "DP-NAMING", "DP-PRIVACY", "DP-TONE"];
  walk(schema, (n) => { const d = n["x-checks"]?.dps; if (d) assert.deepEqual([...d].sort(), ALWAYS); });
  walk(schema, (n) => { const u = n["x-ui"]; if (u) { assert.ok(messages[u.label_msg], u.label_msg); if (u.help_msg) assert.ok(messages[u.help_msg], u.help_msg); assert.ok(messages[`schema.${T}.group.${u.group}`], u.group); } });
  for (const f of ["schema.json", "messages.en.json", ...files("").map((e) => `examples/${e}`)]) assert.ok(!/[–—]/.test(readFileSync(join(ROOT, "content-schemas", T, f), "utf8")), f);
  const doc = join(ROOT, "..", "docs", "design", "ai", "structured-content.md");
  if (!existsSync(doc)) return c.skip("superproject docs not present");
  assert.ok(readFileSync(doc, "utf8").includes(`| \`${T}\` |`));
});

test("path grammar names exactly the problem schema fields, plus stage and stage criteria", () => {
  const alt = schema.properties.path.pattern.match(/^\^\((.*)\|stage_plan\\\./)[1].split("|");
  assert.deepEqual([...alt].sort(), Object.keys(problem.properties).sort());
  const p = (v) => validate({ ...ex("valid-stage-criteria.json"), path: v });
  for (const ok of ["condition", "final_acceptance_criteria", "stage_plan", "stage_plan.map_faults", "stage_plan.map_faults.criteria", "sources", "affected_area", "context_profile"]) assert.ok(p(ok), ok);
  for (const bad of ["Condition", "stage_plan.Map", "stage_plan.map_faults.goal", "stage_plan.", "sources.0", "id", "status", "conditionx"]) assert.equal(p(bad), false, bad);
});

test("resolution_reason is required when accepted or declined, not when open", () => {
  const o = ex("valid-stage-criteria.json");
  assert.ok(validate(o));
  for (const s of ["accepted", "declined"]) { assert.equal(validate({ ...o, status: s }), false, s); assert.ok(validate({ ...o, status: s, resolution_reason: "Added a pole count." }), s); }
});

test("private, masked, merit never checked; limits equal x-guidance", () => {
  assert.equal(schema["x-checks"].private_content, true);
  assert.equal(schema["x-checks"].masked_refs_only, true);
  assert.deepEqual(schema["x-checks"].protected_rules, ["REVIEW-1", "RECO-1"]);
  const L = parse(readFileSync(join(ROOT, "limits.yaml"), "utf8")).fields[T];
  for (const f of ["recommendation", "reason", "resolution_reason"]) {
    const g = schema.properties[f]["x-guidance"];
    assert.deepEqual([L[f].min_chars, L[f].max_chars], [g.min_chars, g.max_chars], f);
    assert.equal(schema.properties[f].minLength, g.min_chars); assert.equal(schema.properties[f].maxLength, g.max_chars);
  }
  assert.ok(schema.properties.recommendation["x-checks"].never_checked_for_merit);
});
