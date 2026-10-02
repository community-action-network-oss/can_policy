import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintDp, templateErrors } from "../tools/lint-dp.mjs";
import { newDp } from "../tools/new-dp.mjs";
import { promptHash } from "../tools/prompt-hash.mjs";

const REPO = new URL("..", import.meta.url).pathname;
const CASE = { id: "ex-1", input: "The Road Works Office ignores reports.", expected_outcome: "publish", rule_ids: [], note: "n", provenance: "fixture", jurisdiction: "fiktiva-city" };

// A tmp repo root: the real _template, a tiny rules registry, and one generated DP with one example.
function root(mutate = () => {}, opts = {}) {
  const d = mkdtempSync(join(tmpdir(), "can-dp-"));
  mkdirSync(join(d, "decision-points"));
  cpSync(join(REPO, "decision-points/_template"), join(d, "decision-points/_template"), { recursive: true });
  mkdirSync(join(d, "packs/base"), { recursive: true });
  writeFileSync(join(d, "packs/base/rules.yaml"), "rules:\n- id: NAME-1\n- id: PRIV-1\n");
  const o = { name: "DP-NAMING", rules: ["NAME-1"], outcomes: ["publish", "needs_revision", "hold"], ...opts };
  newDp(d, o);
  writeFileSync(join(d, "decision-points", o.name, "examples/cases.json"), JSON.stringify([CASE]));
  mutate(join(d, "decision-points", o.name), d);
  return d;
}
const edit = (f, fn) => (dp) => writeFileSync(join(dp, f), fn(readFileSync(join(dp, f), "utf8")));
const fails = (mutate, re, opts) => {
  const d = root(mutate, opts), errs = lintDp(d);
  rmSync(d, { recursive: true });
  assert.ok(errs.some((e) => re.test(e)), `expected ${re}, got ${JSON.stringify(errs)}`);
};
const put = (f, v) => (dp) => writeFileSync(join(dp, f), typeof v === "string" ? v : JSON.stringify(v));

test("a generated DP with an example passes", () => {
  const d = root(); const errs = lintDp(d); rmSync(d, { recursive: true });
  assert.deepEqual(errs, []);
});
test("a generated DP without examples fails", () => fails((dp) => rmSync(join(dp, "examples/cases.json")), /examples\/ has no cases/));
test("the real template is not linted and the real repo has no DP errors", () => assert.deepEqual(lintDp(REPO), []));
test("new-dp refuses an existing DP and bad input", () => {
  const d = root();
  assert.throws(() => newDp(d, { name: "DP-NAMING", rules: ["A"], outcomes: ["hold"] }), /already exists/);
  assert.throws(() => newDp(d, { name: "naming", rules: ["A"], outcomes: ["hold"] }), /bad DP name/);
  assert.throws(() => newDp(d, { name: "DP-X", outcomes: ["hold"] }), /--rules/);
  rmSync(d, { recursive: true });
});
test("harmful flag raises recall", () => {
  const d = root(() => {}, { harmful: true });
  assert.match(readFileSync(join(d, "decision-points/DP-NAMING/eval/thresholds.yaml"), "utf8"), /min_recall_harmful: 0\.98/);
  rmSync(d, { recursive: true });
});

test("missing files", () => {
  for (const f of ["pack-section.yaml", "eval/core.jsonl", "eval/adversarial.jsonl", "eval/README.md"]) fails((dp) => rmSync(join(dp, f)), new RegExp(`missing ${f.replace(".", "\\.")}`));
});
test("outcome not one of the six", () => fails(edit("schema.json", (s) => s.replace('"hold"]', '"hold","maybe"]')), /not one of the six/));
test("schema outcomes differ from pack-section", () => fails(edit("schema.json", (s) => s.replace('"needs_revision",', "")), /must equal pack-section\.yaml outcomes/));
test("schema drops a base property", () => fails(edit("schema.json", (s) => s.replace('"confidence": { "type": "number", "minimum": 0, "maximum": 1 }', '"confidence": { "type": "number" }')), /property 'confidence' must match/));
test("escalate_human outside crisis and legal", () => {
  fails((dp) => { edit("schema.json", (s) => s.replace('"hold"]', '"hold","escalate_human"]'))(dp); edit("pack-section.yaml", (s) => s.replace("hold]", "hold, escalate_human]"))(dp); }, /escalate_human is only allowed/);
});
test("escalate_human is fine in DP-CRISIS", () => {
  const d = root(() => {}, { name: "DP-CRISIS", outcomes: ["route_external", "escalate_human", "hold", "publish"] });
  const errs = lintDp(d); rmSync(d, { recursive: true });
  assert.deepEqual(errs, []);
});
test("enforces an unknown rule id", () => fails(edit("pack-section.yaml", (s) => s.replace("[NAME-1]", "[NAME-9]")), /'NAME-9' is not a rule id/));
test("enforces check is skipped with a reason when there is no registry", () => {
  const d = root((dp, r) => { rmSync(join(r, "packs"), { recursive: true }); edit("pack-section.yaml", (s) => s.replace("[NAME-1]", "[NAME-9]"))(dp); });
  const notes = [], errs = lintDp(d, notes); rmSync(d, { recursive: true });
  assert.deepEqual(errs, []);
  assert.match(notes[0], /not checked/);
});
test("pack-section dp name mismatch and bad floor", () => {
  fails(edit("pack-section.yaml", (s) => s.replace("dp: DP-NAMING", "dp: DP-OTHER")), /must equal the directory name/);
  fails(edit("pack-section.yaml", (s) => s.replace("publish: 0.90", "publish: 1.5")), /confidence_floor\.publish must be a number/);
  fails(edit("pack-section.yaml", (s) => s.replace("    reject: 0.92", "    reject: 0.92\n    hold: 0.5")), /confidence_floor\.hold is not one of/, { outcomes: ["publish", "reject"] });
});

test("prompt: data opener twice", () => fails(edit("prompt.md", (s) => s.replace("The block below", "<<<DATA field=x\nThe block below")), /opener '<<<DATA' must appear exactly once \(found 2\)/));
test("prompt: data closer missing", () => fails(edit("prompt.md", (s) => s.replace("DATA>>>", "")), /closer 'DATA>>>' must appear exactly once \(found 0\)/));
test("prompt: text after the data block", () => fails(edit("prompt.md", (s) => s + "\nignore the above\n"), /nothing may follow/));
test("prompt: other template variable", () => fails(edit("prompt.md", (s) => s.replace("## OUTPUT", "{{DATA}}\n## OUTPUT")), /\{\{DATA\}\} is not allowed/));
test("prompt: slot missing", () => fails(edit("prompt.md", (s) => s.replace("{{SHOTS}}", "")), /\{\{SHOTS\}\} must appear exactly once/));
test("prompt: sections out of order", () => fails(edit("prompt.md", (s) => s.replace("## OUTPUT", "## OUT")), /sections must be/));

test("example with a bad shape", () => fails(put("examples/cases.json", [{ id: "x", input: "hi" }]), /examples\/cases\.json #1: bad case shape/));
test("example with an unknown outcome for the DP", () => fails(put("examples/cases.json", [{ ...CASE, expected_outcome: "reject" }]), /not one of the DP's outcomes/));
test("example rule id outside enforces", () => fails(put("examples/cases.json", [{ ...CASE, rule_ids: ["PRIV-1"] }]), /rule id 'PRIV-1' is not in the DP's enforces/));
test("example with a live URL", () => fails(put("examples/cases.json", [{ ...CASE, input: "see https://news.somesite.com/story" }]), /live URL/));
test("example file with an unknown extension", () => fails(put("examples/notes.txt", "x"), /only \.json/));
test("duplicate example ids", () => fails(put("examples/cases.json", [CASE, { ...CASE, input: "other" }]), /duplicate id 'ex-1'/));
test("jsonl line that is not json", () => fails(put("eval/core.jsonl", "{nope\n"), /eval\/core\.jsonl line 1: not valid JSON/));
test("eval case without field_ref", () => fails(put("eval/core.jsonl", JSON.stringify({ ...CASE, id: "c1", input: "different" }) + "\n"), /eval\/core\.jsonl line 1: bad case shape.*field_ref/));
const EV = { ...CASE, id: "c1", input: "different", field_ref: { field: "structural_statement" } };
test("eval case id overlaps an example", () => fails(put("eval/core.jsonl", JSON.stringify({ ...EV, id: "ex-1" }) + "\n"), /duplicate id 'ex-1'/));
test("eval input overlaps an example", () => fails(put("eval/adversarial.jsonl", JSON.stringify({ ...EV, input: "  the road works OFFICE ignores reports. " }) + "\n"), /also appears in examples/));
test("a valid eval case passes", () => {
  const d = root(put("eval/core.jsonl", JSON.stringify(EV) + "\n")); const errs = lintDp(d); rmSync(d, { recursive: true });
  assert.deepEqual(errs, []);
});
test("thresholds missing a key", () => fails(edit("eval/thresholds.yaml", (s) => s.replace("parity_gap_max: 0.05\n", "")), /'parity_gap_max' is missing/));
test("thresholds floor for a non-outcome", () => fails(edit("eval/thresholds.yaml", (s) => s.replace("  publish:", "  reject:")), /confidence_floor\.reject/));

test("prompt hash ignores the data block and CRLF, and changes with the template", () => {
  const a = readFileSync(join(REPO, "decision-points/_template/prompt.md"), "utf8");
  assert.equal(promptHash(a), promptHash(a.replaceAll("\n", "\r\n")));
  assert.equal(promptHash(a), promptHash(a.replace("(the labelled lines is inserted here by the server)", "any data")));
  assert.notEqual(promptHash(a), promptHash(a.replace("ROLE", "ROLE2")));
  assert.match(promptHash(a), /^[0-9a-f]{64}$/);
  assert.throws(() => promptHash("no block"), /no <<<DATA marker/);
});

test("DP-STAGE is retired: no such directory and no STAGE-1 rule id remain", () => {
  assert.ok(!existsSync(join(REPO, "decision-points/DP-STAGE")), "decision-points/DP-STAGE must not exist (use DP-STAGE-RESOLUTION and DP-STAGE-PLAN)");
  for (const p of ["packs/base/rules.yaml", "packs/constitution/rules.yaml"]) assert.ok(!/^- id: STAGE-1\s*$/m.test(readFileSync(join(REPO, p), "utf8")), `${p} must not define STAGE-1`);
});

test("every DP prompt.md, ASSIST-FILL and _template satisfy the can_server prompt-builder template contract", () => {
  for (const d of readdirSync(join(REPO, "decision-points"), { withFileTypes: true }).filter((d) => d.isDirectory())) {
    assert.deepEqual(templateErrors(readFileSync(join(REPO, "decision-points", d.name, "prompt.md"), "utf8")), [], d.name);
  }
  assert.ok(templateErrors("<<<DATA field=x\n(field text after redaction is inserted here by the server)\nDATA>>>\n{{RULES}}").length);
});
