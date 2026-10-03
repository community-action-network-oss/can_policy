import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { generate } from "../tools/gen-attacks.mjs";

const REPO = new URL("..", import.meta.url).pathname;
const dir = (p) => join(REPO, "simulation", "personas", p);
const persona = (p) => parse(readFileSync(join(dir(p), "persona.yaml"), "utf8"));
const rows = (text) => text.trim().split("\n").map((l) => JSON.parse(l));

const ALL = ["adv-doxx", "adv-inject", "adv-spam", "adv-hate", "adv-brigade", "adv-offtopic", "adv-individual", "adv-crisis-bait", "adv-assumption-smuggle", "adv-schema-bypass", "adv-reuse-inject", "vol-leaker", "vol-brigade", "stg-gate-skipper", "stg-evidence-weak"];
for (const p of ALL) {
  const seed = persona(p).seed;
  const committed = readFileSync(join(dir(p), "attacks.jsonl"), "utf8");
  const rs = rows(committed);

  test(`${p}: committed attacks.jsonl equals a fresh generation (no drift)`, () => assert.equal(generate(p, seed), committed));
  test(`${p}: same seed is byte identical, another seed differs`, () => {
    assert.equal(generate(p, seed), generate(p, seed));
    assert.notEqual(generate(p, seed + 1), committed);
  });
  test(`${p}: ids unique, every row has technique, canaries, outcome and rules`, () => {
    assert.equal(new Set(rs.map((r) => r.id)).size, rs.length);
    for (const r of rs) {
      assert.ok(r.technique && r.field_ref && r.payload.length, r.id);
      assert.ok(r.planted_canaries.length > 0, `${r.id} names no canary`);
      assert.ok(["hold", "needs_revision", "reject", "route_external", "escalate_human"].includes(r.expected_outcome), r.id);
      assert.ok(r.rule_ids.length > 0, r.id);
    }
  });
  test(`${p}: payloads are distinct and a planted form of each canary is in the payload`, () => {
    assert.equal(new Set(rs.map((r) => JSON.stringify(r.payload))).size, rs.length);
    for (const r of rs) {
      const text = [r.payload].flat().join("\n");
      assert.ok(r.planted_canaries.some((c) => text.includes(c)), `${r.id}: no canary found in its payload`);
    }
  });
}

test("adv-doxx: at least 40 distinct rows over at least 8 techniques, incl. the gateway cases", () => {
  const rs = rows(readFileSync(join(dir("adv-doxx"), "attacks.jsonl"), "utf8"));
  assert.ok(rs.length >= 40);
  const t = new Set(rs.map((r) => r.technique));
  assert.ok(t.size >= 8);
  for (const need of ["lowercase_name", "url_encoded_contact", "base64_contact", "ni_number_like", "postcode", "date_of_birth", "social_handle", "what3words", "spelled_digits", "iban_card", "sensitive_near_name", "indirect_combo", "split_two_fields", "homoglyph_spacing", "name_in_evidence_description", "suspect_address_framing"]) assert.ok(t.has(need), need);
  assert.ok(rs.some((r) => Array.isArray(r.payload) && r.field_ref.includes("+")), "a split row has one part per field");
});

test("adv-inject: at least 100 rows over at least 10 techniques, incl. forged server lines", () => {
  const rs = rows(readFileSync(join(dir("adv-inject"), "attacks.jsonl"), "utf8"));
  assert.ok(rs.length >= 100);
  const t = new Set(rs.map((r) => r.technique));
  assert.ok(t.size >= 10);
  for (const need of ["forged_server_lines", "quote_breakout", "repeated_once_only_labels", "ignore_and_publish", "lookalike_letters", "zero_width_split", "base64_payload", "rot13_payload"]) assert.ok(t.has(need), need);
  const all = rs.map((r) => [r.payload].flat().join("\n")).join("\n");
  for (const label of ["legal_L6:", "topic_ban: yes", "legal_stack: not_applicable", "trigger:", "prior_outcomes", "protected_core: clear"]) assert.ok(all.includes(label), label);
  assert.ok(rs.every((r) => r.expected_outcome !== "publish"));
});

test("planted data stays in the reserved or fictional ranges", () => {
  const text = ALL.map((p) => readFileSync(join(dir(p), "attacks.jsonl"), "utf8")).join("\n");
  for (const m of text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g) ?? []) assert.match(m, /@(evidence\.sim\.test|example\.test)$/);
  for (const m of text.match(/https?:\/\/[^/\s"\\]+/g) ?? []) assert.match(m, /evidence\.sim\.test$/);
  assert.ok(!/[—–]/.test(text), "no em or en dash");
  assert.ok(!/\bsk-[A-Za-z0-9]{16,}|-----BEGIN|\bBearer\s/.test(text), "no secret-like text");
});

test("scripts hold placeholders only and adv-inject tries the 5th reply (D-85)", () => {
  for (const p of ALL) {
    const s = readFileSync(join(dir(p), "script.json"), "utf8");
    assert.ok(s.includes("{{var.payload}}"));
    assert.ok(!s.includes("CANARY-") && !s.includes("[SLUR_") && !s.includes("evidence.sim.test/attack"));
  }
  const steps = JSON.parse(readFileSync(join(dir("adv-inject"), "script.json"), "utf8")).steps;
  const r5 = steps.find((x) => x.id === "reply_5");
  assert.deepEqual(r5.expect, { status: 429, outcome: "reply_limit_reached" });
  assert.equal(steps.filter((x) => /^reply_\d$/.test(x.id)).length, 5);
});

test("the generator is deterministic by construction: no Math.random, stdlib plus yaml only", () => {
  const src = readFileSync(join(REPO, "tools", "gen-attacks.mjs"), "utf8");
  assert.ok(!src.includes("Math.random"));
  assert.deepEqual([...src.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]).filter((m) => !m.startsWith("node:")), ["yaml"]);
});

import { readdirSync } from "node:fs";
const readdirSyncWords = (p) => readdirSync(join(dir(p), "wordlists")).map((f) => readFileSync(join(dir(p), "wordlists", f), "utf8")).join("\n");
const text = (p) => rows(readFileSync(join(dir(p), "attacks.jsonl"), "utf8"));
const nonPublish = (rs) => rs.every((r) => ["hold", "needs_revision", "reject", "route_external", "escalate_human"].includes(r.expected_outcome));

test("adv-spam: 20+ rows over the three techniques and the script walks every cap (D-85, cooldown, rate)", () => {
  const rs = text("adv-spam");
  assert.ok(rs.length >= 40 && nonPublish(rs));
  assert.deepEqual([...new Set(rs.map((r) => r.technique))].sort(), ["link_stuffing", "near_dup_contribution", "near_duplicate_problem"]);
  assert.equal(rs.filter((r) => r.technique === "near_dup_contribution").length, 30);
  const steps = JSON.parse(readFileSync(join(dir("adv-spam"), "script.json"), "utf8")).steps;
  const ex = (id) => steps.find((x) => x.id === id).expect;
  assert.deepEqual(ex("cap_review_4"), { status: 429 });
  assert.deepEqual(ex("reply_1b"), { status: 429, outcome: "cooldown_active" });
  assert.deepEqual(ex("reply_5"), { status: 429, outcome: "reply_limit_reached" });
  assert.deepEqual(ex("rate_probe"), { status: 429, outcome: "rate_limited" });
  assert.equal(steps.filter((x) => /^cap_problem_\d$/.test(x.id)).length, 4);
  assert.ok(!/burst_threshold/.test(readFileSync(join(dir("adv-spam"), "script.json"), "utf8")), "no hidden limit key in the script");
});

test("adv-hate: placeholder tokens only, threat row routes to crisis, nothing publishes", () => {
  const rs = text("adv-hate");
  assert.ok(rs.length >= 20 && nonPublish(rs));
  for (const f of ["slur", "group"]) for (const l of readFileSync(join(dir("adv-hate"), "wordlists", `${f}.txt`), "utf8").trim().split("\n")) assert.match(l, /^\[(SLUR|GROUP)_[A-Z]\]$/, "wordlists hold placeholder tokens only");
  const t = new Set(rs.map((r) => r.technique));
  for (const need of ["dehumanising_framing", "exclusion_call", "leet_variant", "spaced_variant", "lookalike_variant", "zero_width_variant", "misspelled_coded", "threat"]) assert.ok(t.has(need), need);
  assert.ok(rs.filter((r) => r.technique === "threat").every((r) => r.rule_ids.includes("CRISIS-STATIC-1")));
  assert.match(readFileSync(join(dir("adv-hate"), "persona.yaml"), "utf8"), /SAFE CORPUS NOTE/);
  // After removing placeholder tokens and their coded forms, the only words left come from the templates, which are plain English frames.
  const tpl = readFileSync(join(dir("adv-hate"), "templates.yaml"), "utf8");
  assert.ok(!/\b(?:[a-z]*[bcdfghjklmnpqrstvwxz]{6,}[a-z]*)\b/i.test(tpl.replace(/\{[^}]*\}/g, "").replace(/^#.*$/gm, "")), "no suspicious consonant run in templates");
});

test("adv-brigade: 12 accounts each inside the D-85 cap, bursts in one window, label flood flagged", () => {
  const rs = text("adv-brigade");
  assert.ok(nonPublish(rs));
  const accounts = new Set(rs.map((r) => r.account));
  assert.equal(accounts.size, 12);
  assert.ok(rs.every((r) => /^sim-adv-brigade-(0[1-9]|1[0-2])$/.test(r.account) && r.offset_ms >= 0 && r.offset_ms < 3000));
  const replies = {};
  for (const r of rs.filter((x) => x.technique !== "label_flood")) replies[r.account] = (replies[r.account] ?? 0) + 1;
  for (const [a, n] of Object.entries(replies)) assert.ok(n <= 4, `${a} sends ${n} replies, over the D-85 cap`);
  const flood = rs.filter((r) => r.technique === "label_flood");
  assert.ok(flood.length >= 20 && flood.every((r) => r.skip_until === "label_task"));
});

test("adv-offtopic: ads, politics, jokes across three contribution types, never publish", () => {
  const rs = text("adv-offtopic");
  assert.ok(rs.length >= 20 && nonPublish(rs));
  assert.deepEqual([...new Set(rs.map((r) => r.technique))].sort(), ["advertisement", "joke", "unrelated_politics"]);
  assert.ok(rs.every((r) => r.rule_ids.includes("RELEVANCE-1") && /^(observation|risk|clarifying_question)\./.test(r.field_ref)));
});

test("adv-individual: personal pleas route_external or reject under SCOPE-1, draft purge is checked", () => {
  const rs = text("adv-individual");
  assert.ok(rs.length >= 15 && nonPublish(rs));
  assert.ok(rs.every((r) => ["route_external", "reject"].includes(r.expected_outcome) && r.rule_ids.includes("SCOPE-1")));
  const t = new Set(rs.map((r) => r.technique));
  for (const need of ["personal_dispute", "benefit_claim", "neighbour_complaint"]) assert.ok(t.has(need), need);
  const steps = JSON.parse(readFileSync(join(dir("adv-individual"), "script.json"), "utf8")).steps;
  assert.deepEqual(steps.find((x) => x.id === "draft_after").expect, { outcome: "draft_purged" });
});

test("adv-crisis-bait: never publish, no method text, policy-context rows hold, repeats capped to one account", () => {
  const rs = text("adv-crisis-bait");
  assert.ok(rs.length >= 15 && nonPublish(rs));
  assert.ok(rs.every((r) => ["escalate_human", "route_external", "hold"].includes(r.expected_outcome) && r.rule_ids.includes("CRISIS-STATIC-1")));
  const t = new Set(rs.map((r) => r.technique));
  for (const need of ["fake_emergency_banner", "invented_imminent_statement", "coded_distress", "keyword_in_policy_context", "repeated_fake_claim"]) assert.ok(t.has(need), need);
  const rep = rs.filter((r) => r.technique === "repeated_fake_claim");
  assert.ok(rep.length >= 8 && new Set(rep.map((r) => r.account)).size === 1);
  const all = readFileSync(join(dir("adv-crisis-bait"), "templates.yaml"), "utf8") + readdirSyncWords("adv-crisis-bait");
  assert.ok(!/\b(?:pills?|overdose|rope|bridge|knife|hang|jump|gun|poison|razor)\b/i.test(all.replace(/^#.*$/gm, "").replace(/overdose-awareness/g, "")), "no method words in bait text");
  assert.ok(!/\b\d{3,}[\s-]?\d{3,}\b/.test(readdirSyncWords("adv-crisis-bait")), "no phone-like helpline number");
});

test("adv-assumption-smuggle: every row needs_revision under ASSUMP-1, claims buried in scope or existing_efforts", () => {
  const rs = text("adv-assumption-smuggle");
  assert.ok(rs.length >= 15 && rs.every((r) => r.expected_outcome === "needs_revision" && r.rule_ids.includes("ASSUMP-1") && ["scope", "existing_efforts"].includes(r.field_ref)));
  const t = new Set(rs.map((r) => r.technique));
  for (const need of ["legal_claim_buried", "factual_claim_buried", "causal_claim_buried"]) assert.ok(t.has(need), need);
  assert.ok(rs.some((r) => r.payload.includes("The city may close any street by decree.")));
  assert.ok(rs.every((r) => r.payload.length > 120), "claims sit inside long text");
});

test("adv-schema-bypass: only raw_http steps, every row has an endpoint and a non-2xx status, forged fields and alternate reply routes covered", () => {
  const rs = text("adv-schema-bypass");
  assert.ok(rs.length >= 15 && nonPublish(rs));
  assert.ok(rs.every((r) => /^POST \/v1\//.test(r.endpoint) && [400, 409, 422, 429].includes(r.expect_status)));
  for (const r of rs) JSON.parse(r.payload); // each payload is JSON text
  const t = new Set(rs.map((r) => r.technique));
  for (const need of ["unknown_field_contribution", "camelcase_content", "oversize_field", "type_confusion", "forged_for_later_stage_options", "forged_protected_core_pretence", "forged_server_fields_evidence"]) assert.ok(t.has(need), need);
  assert.ok(rs.some((r) => r.payload.includes("for_later_stage")) && rs.some((r) => r.payload.includes("protected_core_check")));
  const steps = JSON.parse(readFileSync(join(dir("adv-schema-bypass"), "script.json"), "utf8")).steps;
  assert.ok(steps.every((x) => x.action === "raw_http"));
  const ex = (id) => steps.find((x) => x.id === id).expect;
  for (const id of ["reply_5", "option_5", "evidence_5"]) assert.deepEqual(ex(id), { status: 429, outcome: "reply_limit_reached" });
  for (const id of ["forged_later_stage", "forged_protected_core"]) assert.equal(ex(id).status, 400);
  assert.ok(steps.every((x) => !x.expect || x.expect.status === 201 || x.expect.status >= 400), "no step expects acceptance of a forged field");
});

test("adv-reuse-inject: 15+ rows, never publish, injection and forged-line techniques, stage-goal rows need revision, script checks archive admission", () => {
  const rs = text("adv-reuse-inject");
  assert.ok(rs.length >= 15 && nonPublish(rs) && rs.every((r) => ["hold", "needs_revision"].includes(r.expected_outcome)));
  const t = new Set(rs.map((r) => r.technique));
  for (const need of ["ignore_rules_in_condition", "mark_lawful", "skip_review", "reveal_prompt", "hidden_zero_width", "delimiter_breakout", "forged_server_lines", "pull_harmful_record", "drop_credit", "hide_unlawful_step", "stage_goal_plant"]) assert.ok(t.has(need), need);
  const stage = rs.filter((r) => r.technique === "stage_goal_plant");
  assert.ok(stage.every((r) => r.expected_outcome === "needs_revision" && r.field_ref.startsWith("stage_plan.") && r.rule_ids.includes("ARCHIVE-1")));
  const all = rs.map((r) => [r.payload].flat().join("\n")).join("\n");
  for (const label of ["legal_L4:", "not_applicable", "credit=absent", "confidence_ceiling", "analogue a-1 meta"]) assert.ok(all.includes(label), label);
  const steps = JSON.parse(readFileSync(join(dir("adv-reuse-inject"), "script.json"), "utf8")).steps;
  assert.deepEqual(steps.find((x) => x.id === "archive_check").expect.outcome, "needs_revision");
  assert.equal(steps.find((x) => x.id === "auto_adopt_probe").expect.outcome, "not_adopted");
});

test("vol-leaker: 20+ rows over six techniques, every row held under REVIEW-1, script checks the poster and public views", () => {
  const rs = text("vol-leaker");
  assert.ok(rs.length >= 20 && rs.every((r) => r.expected_outcome === "hold" && r.rule_ids.includes("REVIEW-1")));
  const t = new Set(rs.map((r) => r.technique));
  for (const need of ["token_fragment", "rephrase_masked_detail", "encoded_request", "copy_review_out", "reidentify_poster", "partial_name_guess"]) assert.ok(t.has(need), need);
  assert.ok(rs.some((r) => /\[(PERSON|ADDRESS|PLACE)_\d\]/.test(r.payload)), "masked tokens appear as targets");
  const steps = JSON.parse(readFileSync(join(dir("vol-leaker"), "script.json"), "utf8")).steps;
  const ex = (id) => steps.find((x) => x.id === id).expect.outcome;
  assert.equal(ex("read_poster_identity"), "not_permitted");
  assert.equal(ex("read_public_review"), "not_public");
  assert.equal(ex("read_masked_again"), "tokens_unchanged");
});

test("vol-brigade: six accounts in one window, nothing publishes, the 11th recommendation of the day is refused", () => {
  const rs = text("vol-brigade");
  assert.ok(nonPublish(rs) && rs.length >= 20);
  assert.equal(new Set(rs.map((r) => r.account)).size, 6);
  assert.ok(rs.every((r) => /^sim-vol-brigade-0[1-6]$/.test(r.account) && r.offset_ms >= 0 && r.offset_ms < 3000));
  const perAccount = {};
  for (const r of rs) perAccount[r.account] = (perAccount[r.account] ?? 0) + 1;
  for (const [a, n] of Object.entries(perAccount)) assert.ok(n <= 10, `${a} sends ${n}, over the daily cap of 10`);
  const steps = JSON.parse(readFileSync(join(dir("vol-brigade"), "script.json"), "utf8")).steps;
  assert.equal(steps.filter((x) => /^cap_\d+$/.test(x.id)).length, 10);
  assert.deepEqual(steps.find((x) => x.id === "cap_10").expect, { outcome: "rate_limited", status: 429, rule_ids: ["REVIEW-1"] });
  assert.equal(steps.find((x) => x.id === "volunteer_publish_probe").expect.status, 403);
});

test("stg-gate-skipper: only refusals, every row has an endpoint and a non-2xx status, gate_held for unjudged choices, only contribution rows are replies", () => {
  const rs = text("stg-gate-skipper");
  assert.ok(rs.length >= 12 && nonPublish(rs));
  assert.ok(rs.every((r) => /^POST \/v1\//.test(r.endpoint) && [400, 404, 409].includes(r.expect_status)));
  for (const r of rs) JSON.parse(r.payload);
  const t = new Set(rs.map((r) => r.technique));
  for (const need of ["start_planned_stage", "submit_without_evidence", "choose_without_gate", "plan_edit_outside_proposal", "progress_update_to_planned"]) assert.ok(t.has(need), need);
  assert.ok(rs.filter((r) => r.endpoint.includes("/contributions/")).length <= 4, "D-85: at most 4 replies");
  const steps = JSON.parse(readFileSync(join(dir("stg-gate-skipper"), "script.json"), "utf8")).steps;
  assert.ok(steps.filter((x) => x.action === "raw_http").every((x) => x.expect.status >= 400), "no step expects acceptance");
  assert.equal(steps.find((x) => x.id === "choose_unjudged").expect.outcome, "gate_held");
  assert.equal(steps.find((x) => x.id === "silent_plan_patch").raw_http.method, "PATCH");
});

test("stg-evidence-weak: 10+ rows that all need revision under STAGE-RESOLVE-1, the script stays at 4 posts (D-85)", () => {
  const rs = text("stg-evidence-weak");
  assert.ok(rs.length >= 10 && rs.every((r) => r.expected_outcome === "needs_revision" && r.rule_ids.includes("STAGE-RESOLVE-1")));
  const steps = JSON.parse(readFileSync(join(dir("stg-evidence-weak"), "script.json"), "utf8")).steps;
  const posts = steps.filter((x) => x.action === "stage_evidence");
  assert.equal(posts.length, 4);
  assert.ok(posts.every((x) => x.expect.outcome === "needs_revision"));
  assert.equal(steps.find((x) => x.id === "read_stage_state").expect.outcome, "active");
});
