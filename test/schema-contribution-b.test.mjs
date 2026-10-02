import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rd = (p) => JSON.parse(readFileSync(join(ROOT, "content-schemas", p), "utf8"));
const COMMON = rd("_common/schema.json").$defs.contribution_common.properties;
const COMMON_KEYS = ["target", "claim", "basis", "evidence_refs", "uncertainty", "assumptions"];
const STAGE_KEYS = ["target_stage", "for_later_stage"];
const BASE_DPS = ["DP-CONTRIB-RELEVANCE", "DP-PRIVACY", "DP-NAMING", "DP-TONE", "DP-CRISIS", "DP-ASSUMPTIONS", "DP-COMPLETENESS"];
const strip = (n) => { const { "x-checks": _c, ...r } = n; if (r["x-guidance"]) { const { limits_key: _l, ...g } = r["x-guidance"]; r["x-guidance"] = g; } return r; };
const LIMITS = parse(readFileSync(join(ROOT, "limits.yaml"), "utf8"));
const TYPES = {
 "constraint": {
  "required": [
   "constraint",
   "source",
   "source_ref",
   "recheck_condition"
  ],
  "expect": {
   "invalid-claim-too-short.json": "/claim",
   "invalid-basis-not-allowed.json": "/basis",
   "invalid-too-many-evidence-refs.json": "/evidence_refs",
   "invalid-source-not-allowed.json": "/source"
  },
  "exempt": false,
  "legal": false,
  "extraDps": []
 },
 "stakeholder_perspective": {
  "required": [
   "group",
   "concern",
   "what_would_help"
  ],
  "expect": {
   "invalid-claim-too-short.json": "/claim",
   "invalid-basis-not-allowed.json": "/basis",
   "invalid-too-many-evidence-refs.json": "/evidence_refs",
   "invalid-group-handle.json": "/group",
   "invalid-person-field.json": ""
  },
  "exempt": false,
  "legal": false,
  "extraDps": []
 },
 "proposed_solution": {
  "required": [
   "mechanism",
   "responsible_role",
   "authority",
   "cost",
   "success_metric",
   "risks",
   "lawful_alternatives"
  ],
  "expect": {
   "invalid-claim-too-short.json": "/claim",
   "invalid-basis-not-allowed.json": "/basis",
   "invalid-too-many-evidence-refs.json": "/evidence_refs",
   "invalid-risks-empty.json": "/risks"
  },
  "exempt": false,
  "legal": true,
  "extraDps": []
 },
 "proposal_improvement": {
  "required": [
   "improves",
   "change",
   "mechanism",
   "responsible_role",
   "authority",
   "cost",
   "success_metric",
   "risks",
   "lawful_alternatives"
  ],
  "expect": {
   "invalid-claim-too-short.json": "/claim",
   "invalid-basis-not-allowed.json": "/basis",
   "invalid-too-many-evidence-refs.json": "/evidence_refs",
   "invalid-improves-not-ref.json": "/improves"
  },
  "exempt": false,
  "legal": true,
  "extraDps": []
 },
 "risk": {
  "required": [
   "risk",
   "likelihood_basis",
   "who_bears_it",
   "mitigation_idea"
  ],
  "expect": {
   "invalid-claim-too-short.json": "/claim",
   "invalid-basis-not-allowed.json": "/basis",
   "invalid-too-many-evidence-refs.json": "/evidence_refs",
   "invalid-missing-mitigation-idea.json": ""
  },
  "exempt": false,
  "legal": false,
  "extraDps": []
 },
 "implementation_offer": {
  "required": [
   "offered_work",
   "role_capacity",
   "limits",
   "lawful_basis"
  ],
  "expect": {
   "invalid-claim-too-short.json": "/claim",
   "invalid-basis-not-allowed.json": "/basis",
   "invalid-too-many-evidence-refs.json": "/evidence_refs",
   "invalid-missing-lawful-basis.json": ""
  },
  "exempt": false,
  "legal": true,
  "extraDps": []
 },
 "progress_update": {
  "required": [
   "task_ref",
   "done",
   "not_done",
   "blockers",
   "next_step"
  ],
  "expect": {
   "invalid-claim-too-short.json": "/claim",
   "invalid-basis-not-allowed.json": "/basis",
   "invalid-too-many-evidence-refs.json": "/evidence_refs",
   "invalid-task-ref-not-ref.json": "/task_ref"
  },
  "exempt": true,
  "legal": false,
  "extraDps": [
   "DP-STAGE-RESOLUTION"
  ]
 },
 "verification_evidence": {
  "required": [
   "url",
   "metric_addressed",
   "observation_date",
   "source_role",
   "what_it_does_not_show"
  ],
  "expect": {
   "invalid-claim-too-short.json": "/claim",
   "invalid-basis-not-allowed.json": "/basis",
   "invalid-too-many-evidence-refs.json": "/evidence_refs",
   "invalid-url-not-http.json": "/url"
  },
  "exempt": true,
  "legal": false,
  "extraDps": [
   "DP-EVIDENCE-TIER",
   "DP-VERIFICATION"
  ]
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
    for (const k of STAGE_KEYS) assert.ok(!schema.required.includes(k), `${k} must be optional`);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.type.const, t);
    const doc = join(ROOT, "..", "docs", "design", "ai", "structured-content.md");
    if (!existsSync(doc)) return c.skip("superproject docs not present");
    const row = readFileSync(doc, "utf8").split("\n").find((l) => l.startsWith(`| \`${t}\` |`));
    if (!row) return; // solution types share a prose row, checked by the required list above
    const names = [...row.split("|")[2].matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
    for (const n of spec.required) assert.ok(names.includes(n), `${n} not in table row`);
    for (const n of Object.keys(schema.properties)) if (!["type", ...COMMON_KEYS, ...STAGE_KEYS].includes(n)) assert.ok(names.includes(n), `${n} is not in the table row`);
  });

  test(`${t}: common fields match _common and DPs are as specified`, () => {
    for (const k of COMMON_KEYS) assert.deepEqual(strip(schema.properties[k]), strip(COMMON[k]), k);
    for (const k of STAGE_KEYS) assert.deepEqual(schema.properties[k], rd("contribution.constraint/schema.json").properties[k], k);
    const p = schema.properties;
    assert.deepEqual([p.claim.minLength, p.claim.maxLength], [20, 500]);
    assert.deepEqual([p.evidence_refs.minItems, p.evidence_refs.maxItems], [0, 6]);
    for (const d of BASE_DPS) assert.ok(schema["x-checks"].dps.includes(d), d);
    const dps = schema["x-checks"].dps;
    assert.equal(dps.includes("DP-LEGALITY"), spec.legal);
    for (const d of spec.extraDps) assert.ok(dps.includes(d), d);
    assert.equal(dps.includes("DP-EVIDENCE-TIER"), t === "verification_evidence");
    assert.equal(schema["x-checks"].cooldown_exempt === true, spec.exempt);
    assert.equal(LIMITS.cooldowns.exempt_types.value.includes(t), spec.exempt);
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


test("exempt types in limits.yaml all have a flagged schema", () => {
  for (const t of LIMITS.cooldowns.exempt_types.value) assert.equal(rd(`contribution.${t}/schema.json`)["x-checks"].cooldown_exempt, true, t);
});

test("every contribution type in structured-content.md has a folder", (c) => {
  const doc = join(ROOT, "..", "docs", "design", "ai", "structured-content.md");
  if (!existsSync(doc)) return c.skip("superproject docs not present");
  const lines = readFileSync(doc, "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("| Contribution type |"));
  const types = [];
  for (const l of lines.slice(start + 2)) { if (!l.startsWith("|")) break; types.push(...[...l.split("|")[1].matchAll(/`([a-z_]+)`/g)].map((m) => m[1])); }
  assert.ok(types.length >= 16, `found ${types.length}`);
  for (const t of types) assert.ok(existsSync(join(ROOT, "content-schemas", `contribution.${t}`, "schema.json")), t);
});

test("no contribution schema has a location or label field", () => {
  for (const d of readdirSync(join(ROOT, "content-schemas")).filter((x) => x.startsWith("contribution."))) {
    for (const k of Object.keys(rd(`${d}/schema.json`).properties)) assert.ok(!/^(location|impact_label|label|lat|lng|latitude|longitude|geo|coords?)/i.test(k) && !/_label$/.test(k), `${d}.${k}`);
  }
});

test("stakeholder_perspective: group is shaped as a group, not a person", () => {
  const s = rd("contribution.stakeholder_perspective/schema.json");
  assert.equal(s.properties.group["x-checks"].group_not_person, true);
  assert.equal(s.additionalProperties, false);
  assert.ok(!Object.keys(s.properties).some((k) => /^(person|name|individual|author)/.test(k)));
});

test("moderation_feedback is reserved and unsupported", () => {
  const s = rd("contribution.moderation_feedback/schema.json");
  assert.deepEqual(s.required, ["type"]);
  assert.equal(s["x-checks"].reserved, true);
  assert.equal(s["x-checks"].status, "reserved");
  const ajv = new Ajv2020({ strict: true, strictTypes: false });
  ["version", "pack", "x-ui", "x-guidance", "x-checks", "x-version"].forEach((keyword) => ajv.addKeyword({ keyword }));
  const v = ajv.compile(Object.fromEntries(Object.entries(s).filter(([k]) => k !== "id")));
  for (const f of readdirSync(join(ROOT, "content-schemas", "contribution.moderation_feedback", "examples"))) assert.equal(v(rd(`contribution.moderation_feedback/examples/${f}`)), f.startsWith("valid-"), f);
  assert.ok(existsSync(join(ROOT, "content-schemas", "contribution.moderation_feedback", "README.md")));
});
