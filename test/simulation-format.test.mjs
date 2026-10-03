import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintSimulation, CATALOG } from "../tools/lint-simulation.mjs";
import { lint } from "../tools/lint.mjs";

const REPO = new URL("..", import.meta.url).pathname;
const FRAMINGS = JSON.parse(readFileSync(join(REPO, "simulation", "FRAMINGS.json"), "utf8"));
const PROBLEM = readFileSync(join(REPO, "content-schemas", "problem", "examples", "valid-minimal.json"), "utf8").replace(/[a-z.]*example\.org/g, "evidence.sim.test");

const persona = (o = {}) => ({
  id: "sub-careful", family: "submitter", role: "Resident of fiktiva-city", goals: ["post a sourced problem"], knowledge: "knows the street",
  flaws: [], behaviors: ["answers every hint"], language: "en", turn_budget: 8, seed: 1, synthetic: true, handle: "sim-careful",
  script: "script.json", expected: [{ step_id: "s1", outcomes: ["publish"], dp: "DP-PUBLISH" }], ...o,
});
const script = { steps: [{ id: "s1", action: "submit", content_type: "problem", fields: { condition: "{{seed.condition}}" }, expect: { outcome: "publish" } }] };
const seed = (o = {}) => ({
  id: "seed-1-amsterdam-safety", number: 1, framing: FRAMINGS["1"], jurisdiction: "fiktiva-city", label: "Seed problem, synthetic evidence",
  problem: "problem.json", rubric: "expected.yaml", stage_plan: "stage-plan.json",
  evidence: [{ id: "e1", url: "https://evidence.sim.test/e1", description: "Synthetic report", tier_cap: 2, synthetic: true }],
  variants: ["happy"], personas: ["sub-careful"], ...o,
});
const yaml = (o) => JSON.stringify(o); // JSON is valid YAML

// Builds a tree, lets the test mutate it, returns lint errors.
function run(mutate = () => {}) {
  const d = mkdtempSync(join(tmpdir(), "can-sim-"));
  const w = (rel, text) => { mkdirSync(join(d, rel, ".."), { recursive: true }); writeFileSync(join(d, rel), text); };
  cpSync(join(REPO, "simulation", "FRAMINGS.json"), join(d, "simulation", "FRAMINGS.json"), { recursive: true });
  mkdirSync(join(d, "content-schemas", "problem"), { recursive: true });
  cpSync(join(REPO, "content-schemas", "problem", "schema.json"), join(d, "content-schemas", "problem", "schema.json"));
  w("simulation/personas/sub-careful/persona.yaml", yaml(persona()));
  w("simulation/personas/sub-careful/script.json", JSON.stringify(script));
  w("simulation/seeds/seed-1-amsterdam-safety/seed.yaml", yaml(seed()));
  w("simulation/seeds/seed-1-amsterdam-safety/problem.json", PROBLEM);
  w("simulation/seeds/seed-1-amsterdam-safety/expected.yaml", "[]");
  w("simulation/seeds/seed-1-amsterdam-safety/stage-plan.json", "{}");
  mutate(w, d);
  const errs = lintSimulation(d);
  rmSync(d, { recursive: true });
  return errs;
}
const has = (errs, re) => assert.ok(errs.some((e) => re.test(e)), `expected ${re}, got ${JSON.stringify(errs)}`);
const P = "simulation/personas/sub-careful/persona.yaml", S = "simulation/seeds/seed-1-amsterdam-safety/seed.yaml";

test("valid persona, script and seed pass", () => assert.deepEqual(run(), []));
test("the real repo lints clean, simulation included", () => { assert.deepEqual(lintSimulation(REPO), []); assert.deepEqual(lint(REPO), []); });
test("FRAMINGS.json holds the four D-56 framings", () => {
  assert.deepEqual(Object.keys(FRAMINGS), ["1", "2", "3", "4"]);
  assert.match(FRAMINGS["1"], /^Amsterdam residents face recurring explosions/);
  assert.match(FRAMINGS["4"], /verification problems\.$/);
});
test("the catalog has the volunteer, stage, reuse and attacker ids", () => {
  for (const id of ["vol-careful", "stg-gate-skipper", "prop-reuser", "adv-reuse-inject"]) assert.ok(Object.values(CATALOG).flat().includes(id), id);
});

test("missing synthetic flag fails", () => has(run((w) => { const { synthetic, ...p } = persona(); w(P, yaml(p)); }), /synthetic/));
test("synthetic: false fails", () => has(run((w) => w(P, yaml(persona({ synthetic: false })))), /synthetic/));
test("bad handle fails", () => has(run((w) => w(P, yaml(persona({ handle: "Real_Name" })))), /handle|pattern/));
test("a real-looking email fails", () => has(run((w) => w(P, yaml(persona({ knowledge: "mail jan.devries@example.com" })))), /email/));
test("a phone number fails", () => has(run((w) => w(P, yaml(persona({ knowledge: "call +31 20 555 0199" })))), /phone/));
test("a street address fails", () => has(run((w) => w(P, yaml(persona({ knowledge: "lives at 12 Main Street" })))), /street-address/));
test("a non-fake host fails", () => has(run((w) => w(P, yaml(persona({ knowledge: "see https://news.example.org/a" })))), /host 'news\.example\.org'/));
test("a non-fake evidence url fails", () => has(run((w) => w(S, yaml(seed({ evidence: [{ id: "e1", url: "https://real.example.org/x", description: "d", tier_cap: 1, synthetic: true }] })))), /seed schema|host/));
test("a credential fails", () => has(run((w) => w(P, yaml(persona({ knowledge: "password: hunter2hunter2" })))), /credential/));
test("an en dash fails", () => has(run((w) => w(P, yaml(persona({ role: "a – b" })))), /dash/));
test("wrong framing fails", () => has(run((w) => w(S, yaml(seed({ framing: "Amsterdam is dirty." })))), /byte for byte/));
test("unknown persona id in a seed fails", () => has(run((w) => w(S, yaml(seed({ personas: ["sub-careful", "sub-ghost"] })))), /sub-ghost/));
test("a persona outside the catalog fails", () => has(run((w) => { w("simulation/personas/sub-invented/persona.yaml", yaml(persona({ id: "sub-invented" }))); w("simulation/personas/sub-invented/script.json", JSON.stringify(script)); }), /not in the persona catalog/));
test("an adversarial persona needs attack_goal and pass_condition", () => has(run((w) => {
  w("simulation/personas/adv-spam/persona.yaml", yaml(persona({ id: "adv-spam", family: "adversarial", handle: "sim-spam" })));
  w("simulation/personas/adv-spam/script.json", JSON.stringify(script));
}), /attack_goal/));
test("a 5th reply that expects 429 reply_limit_reached is a valid step", () => assert.deepEqual(run((w) => {
  const adv = persona({ id: "adv-spam", family: "adversarial", handle: "sim-spam", attack_goal: "exceed the reply cap", pass_condition: "5th reply gets 429", expected: [{ step_id: "r5", outcomes: ["reply_limit_reached"] }] });
  w("simulation/personas/adv-spam/persona.yaml", yaml(adv));
  w("simulation/personas/adv-spam/script.json", JSON.stringify({ steps: [{ id: "r5", action: "contribute", expect: { status: 429, outcome: "reply_limit_reached" } }] }));
}), []));
test("raw_http is only for adv-schema-bypass", () => has(run((w) => w("simulation/personas/sub-careful/script.json", JSON.stringify({ steps: [{ id: "s1", action: "raw_http", raw_http: { method: "POST", path: "/x" } }] }))), /raw_http/));
test("an unknown script action fails", () => has(run((w) => w("simulation/personas/sub-careful/script.json", JSON.stringify({ steps: [{ id: "s1", action: "eval" }] }))), /script schema/));
test("an expected step_id that is not in the script fails", () => has(run((w) => w(P, yaml(persona({ expected: [{ step_id: "nope", outcomes: ["publish"] }] })))), /nope/));
test("a problem body invalid for the problem schema fails", () => has(run((w) => w("simulation/seeds/seed-1-amsterdam-safety/problem.json", "{}")), /problem content schema/));
