import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { lint } from "../tools/lint.mjs";

const REPO = new URL("..", import.meta.url).pathname;
const VALID = new URL("./fixtures/valid", import.meta.url).pathname;

// Copy of the valid fixture with limits.yaml edited (hash drift is not what these tests probe).
function withLimits(edit, extra) {
  const dir = mkdtempSync(join(tmpdir(), "can-limits-"));
  cpSync(VALID, dir, { recursive: true });
  const L = parse(readFileSync(join(dir, "limits.yaml"), "utf8"));
  edit(L);
  writeFileSync(join(dir, "limits.yaml"), stringify(L));
  extra?.(dir);
  const errs = lint(dir).filter((e) => !/hash drift|manifest|release/i.test(e));
  rmSync(dir, { recursive: true });
  return errs;
}
const fails = (errs, re) => assert.ok(errs.some((e) => re.test(e)), `expected ${re}, got ${JSON.stringify(errs)}`);
const field = { min_chars: 20, max_chars: 400, note: "x" };

test("the repo limits.yaml is valid and holds the OQ-limits defaults", () => {
  assert.deepEqual(lint(REPO).filter((e) => e.startsWith("limits.yaml")), []); // pack-wide health is lint.test.mjs
  const L = parse(readFileSync(join(REPO, "limits.yaml"), "utf8"));
  assert.deepEqual([L.caps.problems_per_account_per_period.count, L.caps.problems_per_account_per_period.days], [3, 7]);
  assert.equal(L.caps.contributions_per_account_per_day.total, 20);
  assert.equal(L.caps.contributions_per_account_per_day.per_problem, undefined); // D-85 cap governs per-problem volume
  assert.deepEqual([L.caps.replies_per_account_per_problem_per_day.count, L.caps.replies_per_account_per_problem_per_day.days], [4, 1]);
  assert.equal(L.caps.proposals_per_account_per_problem.value, 2);
  assert.equal(L.caps.open_drafts_per_account.value, 5);
  assert.deepEqual([L.caps.appeals_per_account_per_period.count, L.caps.appeals_per_account_per_period.days], [3, 7]);
  assert.equal(L.cooldowns.between_contributions_same_problem.seconds, 120);
  assert.equal(L.cooldowns.after_rejected_contribution.seconds, 600);
  assert.equal(L.cooldowns.between_contributions_same_problem.provisional, true);
  assert.deepEqual(L.cooldowns.exempt_types.value, ["progress_update", "verification_evidence"]);
  assert.equal(L.grace.schema_major_draft_days.value, 30);
  assert.equal(L.risk_period.burst_threshold.public, false);
});

test("unknown key fails", () => fails(withLimits((L) => { L.caps.bogus = 1; }), /limits schema/));
test("negative number fails", () => fails(withLimits((L) => { L.caps.open_drafts_per_account.value = -1; }), /limits schema/));
test("min_chars above max_chars fails", () => fails(withLimits((L) => { L.fields.problem = { condition: { ...field, min_chars: 500 } }; }), /min_chars is greater than max_chars/));
test("matching bounds pass", () => assert.deepEqual(withLimits((L) => { L.fields.problem = { condition: field }; }), []));
test("bounds that differ from x-guidance fail", () => fails(withLimits((L) => { L.fields.problem = { condition: { ...field, max_chars: 300 } }; }), /max_chars is 300 but x-guidance says 400/));
test("a path to a field the schema lacks fails", () => fails(withLimits((L) => { L.fields.problem = { ghost: field }; }), /no property 'ghost'/));
test("a type with no schema yet is not checked", () => assert.deepEqual(withLimits((L) => { L.fields.future_type = { anything: field }; }), []));

test("the docs example reveals no public: false value", () => {
  const L = parse(readFileSync(join(REPO, "limits.yaml"), "utf8"));
  const hidden = [];
  (function scan(o) {
    if (o && typeof o === "object") {
      if (o.public === false) hidden.push(...Object.values(o.value ?? {}).map(String));
      Object.values(o).forEach(scan);
    }
  })(L);
  assert.ok(hidden.length > 0);
  const doc = readFileSync(join(REPO, "docs/limits.md"), "utf8");
  const example = doc.split("```text")[1].split("```")[0];
  for (const v of hidden) assert.ok(!example.includes(v), `example leaks ${v}`);
});
