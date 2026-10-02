import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, mkdtempSync, cpSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { lint } from "../tools/lint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rd = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const CS = (p) => rd(`content-schemas/${p}`);

const TYPES = {
  appeal: {
    required: ["decision_ref", "what_is_wrong", "outcome_sought"],
    dps: ["DP-APPEAL", "DP-PRIVACY"],
    expect: { "missing-decision-ref": "", "rule-id-not-an-id": "/rule_ids_disputed/0", "evidence-url-not-http": "/new_evidence_refs/0/url", "extra-field": "" },
  },
  policy_proposal: {
    required: ["rule_ids_and_dps_touched", "change_summary", "reason", "motivating_examples", "expected_flips", "protected_core_check", "rollback_plan", "who_is_affected", "lawful_basis", "risks"],
    dps: ["DP-PRIVACY", "DP-LAWFULNESS"],
    expect: { "protected-core-not-acknowledged": "/protected_core_check/acknowledged", "no-motivating-examples": "/motivating_examples", "example-is-raw-text": "/motivating_examples/0", "missing-rollback-plan": "", "rule-id-not-an-id": "/rule_ids_and_dps_touched/0" },
  },
};
const mk = (schema) => {
  const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
  ["version", "pack", "x-ui", "x-guidance", "x-checks", "x-version"].forEach((keyword) => ajv.addKeyword({ keyword }));
  return ajv.compile(Object.fromEntries(Object.entries(schema).filter(([k]) => k !== "id")));
};
const walk = (n, fn) => { if (Array.isArray(n)) n.forEach((x) => walk(x, fn)); else if (n && typeof n === "object") { fn(n); Object.values(n).forEach((x) => walk(x, fn)); } };

for (const [t, spec] of Object.entries(TYPES)) {
  const schema = CS(`${t}/schema.json`), messages = CS(`${t}/messages.en.json`), validate = mk(schema);
  const files = (p) => readdirSync(join(ROOT, "content-schemas", t, "examples")).filter((f) => f.startsWith(p)).sort();

  test(`${t}: lint clean`, () => assert.deepEqual(lint(ROOT).filter((e) => e.includes(t)), []));

  test(`${t}: valid examples pass, invalid fail where expected`, () => {
    assert.ok(files("valid-").length >= 2);
    for (const f of files("valid-")) assert.ok(validate(CS(`${t}/examples/${f}`)), `${f}: ${JSON.stringify(validate.errors)}`);
    assert.deepEqual(files("invalid-"), Object.keys(spec.expect).map((k) => `invalid-${k}.json`).sort());
    for (const [k, ptr] of Object.entries(spec.expect)) {
      const f = `invalid-${k}.json`;
      assert.equal(validate(CS(`${t}/examples/${f}`)), false, f);
      assert.ok(validate.errors.some((e) => e.instancePath === ptr), `${f}: expected ${ptr || "root"}, got ${validate.errors.map((e) => e.instancePath || "root")}`);
    }
  });

  test(`${t}: required list, DPs and messages`, (c) => {
    assert.deepEqual(schema.required, spec.required);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.pack, "base@1.0.0"); assert.equal(schema.version, "1.0.0");
    for (const d of spec.dps) assert.ok(schema["x-checks"].dps.includes(d), d);
    walk(schema, (n) => { const u = n["x-ui"]; if (u) { assert.ok(messages[u.label_msg], u.label_msg); if (u.help_msg) assert.ok(messages[u.help_msg], u.help_msg); if (u.group) assert.ok(messages[`schema.${t}.group.${u.group}`], u.group); } });
    for (const f of ["schema.json", "messages.en.json", ...files("").map((e) => `examples/${e}`)]) assert.ok(!/[–—]/.test(readFileSync(join(ROOT, "content-schemas", t, f), "utf8")), f);
    const doc = join(ROOT, "..", "docs", "design", "ai", "structured-content.md");
    if (!existsSync(doc)) return c.skip("superproject docs not present");
    assert.ok(readFileSync(doc, "utf8").includes(`| \`${t}\` |`));
  });
}

test("appeal never asks for more than the spec: three required fields, rule ids and evidence optional, no tone gate", () => {
  const s = CS("appeal/schema.json"), p = s.properties;
  assert.equal(s["x-checks"].never_blocks_appeal, true);
  for (const k of ["rule_ids_disputed", "new_evidence_refs"]) assert.ok(!s.required.includes(k), k);
  assert.ok(p.what_is_wrong.minLength <= 10 && p.outcome_sought.minLength <= 10);
  assert.ok(!p.what_is_wrong["x-checks"].dps.includes("DP-TONE"));
  assert.ok(p.new_evidence_refs["x-checks"].dps.includes("DP-PRIVACY"));
  assert.equal(p.new_evidence_refs["x-checks"].no_new_personal_data, true);
  assert.deepEqual(s["x-checks"].protected_rules, ["APPEAL-1", "APPEAL-2"]);
});

test("policy_proposal: masked refs only, protected-core acknowledgement", () => {
  const p = CS("policy_proposal/schema.json").properties;
  assert.equal(p.motivating_examples["x-checks"].masked_refs_only, true);
  assert.deepEqual(p.protected_core_check.required, ["acknowledged", "touches_protected_core"]);
});

// lint: versions and migration maps
const FIX = join(ROOT, "test", "fixtures", "valid");
const cur = (version, required) => ({ id: "widget", version, "x-version": version, pack: "base@1.0.0", type: "object", additionalProperties: false, required, properties: { a: { type: "string" }, b: { type: "string" }, c: { type: "string" } } });
const MAP = { type: "widget", from: "1.0.0", to: "2.0.0", fields: [{ from_path: "a", to_path: "a", transform: "copy", note: "same" }], new_required: ["b"], dropped: [] };
function scenario({ version, required, map, oldRequired = ["a"] }) {
  const dir = mkdtempSync(join(tmpdir(), "can-policy-ver-"));
  cpSync(FIX, dir, { recursive: true });
  const base = join(dir, "content-schemas", "widget");
  mkdirSync(join(base, "versions"), { recursive: true });
  writeFileSync(join(base, "versions", "1.0.0.schema.json"), JSON.stringify(cur("1.0.0", oldRequired)));
  writeFileSync(join(base, "schema.json"), JSON.stringify(cur(version, required)));
  if (map) { mkdirSync(join(base, "migrations")); writeFileSync(join(base, "migrations", "1.0.0-to-2.0.0.json"), JSON.stringify(map)); }
  const errs = lint(dir).filter((e) => e.includes("widget"));
  rmSync(dir, { recursive: true });
  return errs;
}
test("lint: major bump with a migration map passes", () => assert.deepEqual(scenario({ version: "2.0.0", required: ["a", "b"], map: MAP }), []));
test("lint: major bump without a migration map fails", () => assert.match(scenario({ version: "2.0.0", required: ["a", "b"] }).join(), /needs content-schemas\/widget\/migrations\/1\.0\.0-to-2\.0\.0\.json/));
test("lint: major map that misses a new required field fails", () => assert.match(scenario({ version: "2.0.0", required: ["a", "b"], map: { ...MAP, new_required: [] } }).join(), /'b' is missing from new_required/));
test("lint: major map that is malformed fails", () => assert.match(scenario({ version: "2.0.0", required: ["a", "b"], map: { type: "widget" } }).join(), /fails migration map schema/));
test("lint: minor bump with a new required field fails", () => assert.match(scenario({ version: "1.1.0", required: ["a", "b"] }).join(), /changes the required set \(b\)/));
test("lint: minor bump with a new optional field passes", () => assert.deepEqual(scenario({ version: "1.1.0", required: ["a"] }), []));
test("lint: patch bump removing a required field fails", () => assert.match(scenario({ version: "1.0.1", required: [] }).join(), /changes the required set/));
test("lint: current version not above retired fails", () => assert.match(scenario({ version: "1.0.0", required: ["a"] }).join(), /not higher than retired/));
