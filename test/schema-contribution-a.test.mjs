import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rd = (p) => JSON.parse(readFileSync(join(ROOT, "content-schemas", p), "utf8"));
const COMMON = rd("_common/schema.json").$defs.contribution_common.properties;
const COMMON_KEYS = ["target", "claim", "basis", "evidence_refs", "uncertainty", "assumptions"];
const BASE_DPS = ["DP-CONTRIB-RELEVANCE", "DP-PRIVACY", "DP-NAMING", "DP-TONE", "DP-CRISIS", "DP-ASSUMPTIONS", "DP-COMPLETENESS"];
const strip = (n) => { const { "x-checks": _c, ...r } = n; if (r["x-guidance"]) { const { limits_key: _l, ...g } = r["x-guidance"]; r["x-guidance"] = g; } return r; };

// type -> [extra required fields in table order, expected shape failures by file (pointer)]
const TYPES = {
 "clarifying_question": {
  "required": [
   "missing_information",
   "why_it_matters",
   "who_could_answer"
  ],
  "expect": {
   "invalid-claim-too-short.json": "/claim",
   "invalid-basis-not-allowed.json": "/basis",
   "invalid-too-many-evidence-refs.json": "/evidence_refs",
   "invalid-missing-missing-information.json": ""
  }
 },
 "observation": {
  "required": [
   "what_observed",
   "when",
   "where_coarse",
   "how_observed"
  ],
  "expect": {
   "invalid-claim-too-short.json": "/claim",
   "invalid-basis-not-allowed.json": "/basis",
   "invalid-too-many-evidence-refs.json": "/evidence_refs",
   "invalid-missing-what-observed.json": "",
   "invalid-address-in-where-coarse.json": "/where_coarse"
  }
 },
 "personal_experience": {
  "required": [
   "pattern_illustrated",
   "period"
  ],
  "expect": {
   "invalid-claim-too-short.json": "/claim",
   "invalid-basis-not-allowed.json": "/basis",
   "invalid-too-many-evidence-refs.json": "/evidence_refs",
   "invalid-missing-pattern-illustrated.json": "",
   "invalid-narrative-property.json": ""
  }
 },
 "factual_claim": {
  "required": [
   "statement"
  ],
  "expect": {
   "invalid-claim-too-short.json": "/claim",
   "invalid-basis-not-allowed.json": "/basis",
   "invalid-too-many-evidence-refs.json": "/evidence_refs",
   "invalid-neither-source-nor-none-stated.json": "",
   "invalid-both-source-and-none-stated.json": "",
   "invalid-missing-statement.json": ""
  }
 },
 "evidence": {
  "required": [
   "url",
   "source_description",
   "claim_supported",
   "what_it_does_not_show"
  ],
  "expect": {
   "invalid-claim-too-short.json": "/claim",
   "invalid-basis-not-allowed.json": "/basis",
   "invalid-too-many-evidence-refs.json": "/evidence_refs",
   "invalid-missing-url.json": "",
   "invalid-url-not-http.json": "/url",
   "invalid-file-upload-property.json": ""
  }
 },
 "interpretation": {
  "required": [
   "reading_of",
   "alternatives_considered"
  ],
  "expect": {
   "invalid-claim-too-short.json": "/claim",
   "invalid-basis-not-allowed.json": "/basis",
   "invalid-too-many-evidence-refs.json": "/evidence_refs",
   "invalid-missing-reading-of.json": ""
  }
 },
 "root_cause": {
  "required": [
   "hypothesis",
   "mechanism",
   "supporting_evidence_refs",
   "test_that_would_disprove_it"
  ],
  "expect": {
   "invalid-claim-too-short.json": "/claim",
   "invalid-basis-not-allowed.json": "/basis",
   "invalid-too-many-evidence-refs.json": "/evidence_refs",
   "invalid-missing-hypothesis.json": ""
  }
 }
};

const ids = (n, acc = new Set()) => {
  if (Array.isArray(n)) n.forEach((x) => ids(x, acc));
  else if (n && typeof n === "object") {
    const u = n["x-ui"];
    if (u) { acc.add(u.label_msg); if (u.help_msg) acc.add(u.help_msg); }
    Object.values(n).forEach((x) => ids(x, acc));
  }
  return acc;
};
const groupIds = (n, acc = new Set()) => { if (Array.isArray(n)) n.forEach((x) => groupIds(x, acc)); else if (n && typeof n === "object") { if (n["x-ui"]?.group) acc.add(n["x-ui"].group); Object.values(n).forEach((x) => groupIds(x, acc)); } return acc; };

for (const [t, spec] of Object.entries(TYPES)) {
  const dir = `contribution.${t}`;
  const schema = rd(`${dir}/schema.json`), messages = rd(`${dir}/messages.en.json`);
  const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
  ["version", "pack", "x-ui", "x-guidance", "x-checks", "x-version"].forEach((keyword) => ajv.addKeyword({ keyword }));
  const validate = ajv.compile(Object.fromEntries(Object.entries(schema).filter(([k]) => k !== "id")));
  const files = (prefix) => readdirSync(join(ROOT, "content-schemas", dir, "examples")).filter((f) => f.startsWith(prefix)).sort();

  test(`${t}: meta-valid through lint`, async () => {
    const { lint } = await import("../tools/lint.mjs");
    assert.deepEqual(lint(ROOT).filter((e) => e.includes(dir) || e.includes("_common") || e.includes("limits.yaml")), []);
  });

  test(`${t}: valid examples pass, invalid fail where expected`, () => {
    const v = files("valid-"); assert.ok(v.length >= 2);
    for (const f of v) assert.ok(validate(rd(`${dir}/examples/${f}`)), `${f}: ${ajv.errorsText(validate.errors)}`);
    const inv = files("invalid-"); assert.ok(inv.length >= 3);
    assert.deepEqual(inv, Object.keys(spec.expect).sort());
    for (const [f, ptr] of Object.entries(spec.expect)) {
      assert.equal(validate(rd(`${dir}/examples/${f}`)), false, f);
      assert.ok(validate.errors.some((e) => e.instancePath === ptr), `${f}: expected ${ptr || "root"}, got ${validate.errors.map((e) => e.instancePath || "root")}`);
    }
  });

  test(`${t}: required list equals the structured-content table`, (c) => {
    assert.deepEqual(schema.required, ["type", ...COMMON_KEYS, ...spec.required]);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.type.const, t);
    const doc = join(ROOT, "..", "docs", "design", "ai", "structured-content.md");
    if (!existsSync(doc)) return c.skip("superproject docs not present");
    const row = readFileSync(doc, "utf8").split("\n").find((l) => l.startsWith(`| \`${t}\` |`));
    const names = [...row.split("|")[2].matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
    for (const n of spec.required) assert.ok(names.includes(n), `${n} not in table row`);
    for (const n of Object.keys(schema.properties)) if (!["type", ...COMMON_KEYS].includes(n)) assert.ok(names.includes(n), `${n} is not in the table row`);
  });

  test(`${t}: common fields match _common and DPs are as specified`, () => {
    for (const k of COMMON_KEYS) assert.deepEqual(strip(schema.properties[k]), strip(COMMON[k]), k);
    const p = schema.properties;
    assert.deepEqual([p.claim.minLength, p.claim.maxLength], [20, 500]);
    assert.deepEqual([p.evidence_refs.minItems, p.evidence_refs.maxItems], [0, 6]);
    for (const d of BASE_DPS) assert.ok(schema["x-checks"].dps.includes(d), d);
    assert.equal(schema["x-checks"].dps.includes("DP-EVIDENCE-TIER"), t === "evidence");
    assert.ok(!schema["x-checks"].dps.includes("DP-LEGALITY"));
    if (t === "personal_experience") assert.equal(schema["x-checks"].dps[0], "DP-PRIVACY");
    assert.equal(p.claim["x-guidance"].limits_key, `fields.contribution.${t}.claim`);
  });

  test(`${t}: every message id exists`, () => {
    for (const id of ids(schema)) if (id.includes(".")) assert.ok(messages[id], `missing message ${id}`);
    for (const g of groupIds(schema)) assert.ok(messages[`schema.contribution.${g === "details" ? t : "common"}.group.${g}`], `missing group ${g}`);
    assert.ok(messages[`schema.contribution.${t}.group.details`]);
  });

  test(`${t}: no em or en dashes`, () => {
    for (const f of ["schema.json", "messages.en.json", ...readdirSync(join(ROOT, "content-schemas", dir, "examples")).map((e) => `examples/${e}`)]) assert.ok(!/[\u2013\u2014]/.test(readFileSync(join(ROOT, "content-schemas", dir, f), "utf8")), f);
  });
}

test("factual_claim needs exactly one of source_ref or none_stated", () => {
  const s = rd("contribution.factual_claim/schema.json");
  assert.ok(s.properties.source_ref && s.properties.none_stated && !s.required.includes("source_ref"));
  assert.deepEqual(s.oneOf.map((b) => b.required), [["source_ref"], ["none_stated"]]);
});

test("personal_experience has no narrative property and rejects one", () => {
  const s = rd("contribution.personal_experience/schema.json");
  assert.ok(!Object.keys(s.properties).some((k) => /narrative|story/.test(k)));
  assert.equal(s.additionalProperties, false);
});

test("evidence is URL only", () => {
  const s = rd("contribution.evidence/schema.json");
  assert.equal(s.properties.url.pattern, "^https?://\\S+$");
  assert.equal(s.additionalProperties, false);
});
