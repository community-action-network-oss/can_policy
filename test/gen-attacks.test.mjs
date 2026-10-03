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

for (const p of ["adv-doxx", "adv-inject"]) {
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
      assert.ok(["hold", "needs_revision", "reject"].includes(r.expected_outcome), r.id);
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
  const text = ["adv-doxx", "adv-inject"].map((p) => readFileSync(join(dir(p), "attacks.jsonl"), "utf8")).join("\n");
  for (const m of text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g) ?? []) assert.match(m, /@(evidence\.sim\.test|example\.test)$/);
  for (const m of text.match(/https?:\/\/[^/\s"\\]+/g) ?? []) assert.match(m, /evidence\.sim\.test$/);
  assert.ok(!/[—–]/.test(text), "no em or en dash");
  assert.ok(!/\bsk-[A-Za-z0-9]{16,}|-----BEGIN|\bBearer\s/.test(text), "no secret-like text");
});

test("scripts hold placeholders only and adv-inject tries the 5th reply (D-85)", () => {
  for (const p of ["adv-doxx", "adv-inject"]) {
    const s = readFileSync(join(dir(p), "script.json"), "utf8");
    assert.ok(s.includes("{{var.payload}}"));
    assert.ok(!s.includes("CANARY-") && !s.includes("evidence.sim.test/attack"));
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
