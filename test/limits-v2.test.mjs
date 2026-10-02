import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { lint } from "../tools/lint.mjs";

const REPO = new URL("..", import.meta.url).pathname;
const L = parse(readFileSync(new URL("../limits.yaml", import.meta.url), "utf8"));
const v = (o) => o.value;

test("the repo limits.yaml lints with the v2 blocks", () => assert.deepEqual(lint(REPO).filter((e) => e.startsWith("limits.yaml")), []));

test("rank weights sum to 1.0 and match the design defaults", () => {
  const { provisional, note, ...w } = L.archive.rank_weights;
  assert.equal(Object.keys(w).length, 8);
  assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.deepEqual([w.problem_type, w.language], [0.25, 0.05]);
});

test("new keys exist with the documented defaults", () => {
  const A = L.archive;
  assert.deepEqual([v(A.derank_factor), v(A.rrf_k), v(A.top_k_fusion), v(A.top_n_shown), v(A.max_per_source_problem)], [0.5, 60, 30, 5, 2]);
  for (const k of ["completeness_bonus", "solved_bonus", "min_candidate_score", "taxonomy", "cross_language_recall_floor"]) assert.ok(A[k], k);
  assert.ok(v(L.metrics.min_n) > 0);
  const S = L.suggestions;
  assert.deepEqual([S.debounce_trailing_seconds.seconds, S.idle_typing_seconds.seconds, v(S.max_runs_per_hour_per_draft), v(S.stage_draft_expiry_days)], [5, 1.5, 6, 30]);
  assert.ok(v(S.run_budget_micro_usd) > 0);
  assert.deepEqual([v(L.review.quorum_completed_reviews), v(L.review.recommendation_open_max_days), v(L.review.publish_anyway_after_days)], [3, 7, 14]);
  assert.equal(v(L.stage.auto_start_default), true);
  const C = L.location;
  assert.deepEqual([v(C.k_min_cells), v(C.h3_resolution), C.challenge_ttl_seconds.seconds, v(C.history_ttl_hours)], [25, 8, 120, 24]);
});

test("location rate and surge thresholds are hidden", () => {
  for (const k of ["rate_per_account_per_area_per_hour", "rate_per_account_per_day", "impacted_cap_per_area_per_day", "surge_new_account_days", "plausibility_max_speed_kmh"]) assert.equal(L.location[k].public, false, k);
});

test("every new leaf is provisional and no location block key stores a position", () => {
  for (const b of ["archive", "metrics", "suggestions", "review", "stage", "location"]) {
    for (const [k, leaf] of Object.entries(L[b])) assert.equal(leaf.provisional, true, `${b}.${k}`);
  }
  assert.ok(!Object.keys(L.location).some((k) => /lat|lon|coord|position|cell_id/.test(k)));
});

test("every new key is documented in docs/limits.md", () => {
  const doc = readFileSync(new URL("../docs/limits.md", import.meta.url), "utf8");
  for (const b of ["archive", "metrics", "suggestions", "review", "stage", "location"]) {
    for (const k of Object.keys(L[b])) assert.ok(doc.includes(`${b}.${k}`) || doc.includes(`${b}.<dimension>`) && k === "rank_weights", `${b}.${k}`);
  }
});
