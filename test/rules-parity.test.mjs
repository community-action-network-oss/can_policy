import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkParity, readRegistry, readPacks, snapshot } from "../tools/rules-parity.mjs";

const REPO = new URL("..", import.meta.url).pathname;
const hasDocs = existsSync(join(REPO, "..", "docs", "spec", "constitution", "rules.md"));
const skip = hasDocs ? false : "superproject not present";

// A copy of the packs and snapshot; with docs, placed beside a copy of the registry so ../docs resolves.
function copy(mutate) {
  const top = mkdtempSync(join(tmpdir(), "can-parity-"));
  const root = join(top, "can_policy");
  mkdirSync(join(root, "ci", "fixtures"), { recursive: true });
  cpSync(join(REPO, "packs"), join(root, "packs"), { recursive: true });
  cpSync(join(REPO, "ci", "fixtures"), join(root, "ci", "fixtures"), { recursive: true });
  if (hasDocs) cpSync(join(REPO, "..", "docs", "spec", "constitution"), join(top, "docs", "spec", "constitution"), { recursive: true, filter: (s) => !s.includes("/tools") });
  mutate?.(root, top);
  return { root, done: () => rmSync(top, { recursive: true }) };
}
const edit = (f, fn) => writeFileSync(f, fn(readFileSync(f, "utf8")));
const run = (mutate) => { const c = copy(mutate); const r = checkParity(c.root); c.done(); return r.errors; };

test("the committed packs are in parity with the snapshot (and the registry when present)", () => assert.deepEqual(checkParity(REPO).errors, []));
test("the snapshot is current", () => assert.equal(readFileSync(join(REPO, "ci/fixtures/rules-registry.snapshot.json"), "utf8"), snapshot(REPO)));
test("every registry rule appears exactly once across the two packs", { skip }, () => {
  const reg = readRegistry(REPO);
  const { rules, errors } = readPacks(REPO);
  assert.deepEqual(errors, []);
  assert.deepEqual([...rules.keys()].sort(), [...reg.keys()].sort());
  assert.ok(!rules.has("STAGE-1"), "STAGE-1 is retired");
});
test("moving a rule between packs keeps parity", () => {
  assert.deepEqual(run((root) => {
    const b = join(root, "packs/base/rules.yaml"), c = join(root, "packs/constitution/rules.yaml");
    const block = readFileSync(b, "utf8").match(/- id: MONEY-0\n(?:  .*\n)+/)[0];
    edit(b, (s) => s.replace(block, ""));
    edit(c, (s) => s + block);
  }), []);
});
test("a rule listed in both packs fails", () => {
  const errs = run((root) => {
    const block = readFileSync(join(root, "packs/base/rules.yaml"), "utf8").match(/- id: MONEY-0\n(?:  .*\n)+/)[0];
    edit(join(root, "packs/constitution/rules.yaml"), (s) => s + block);
  });
  assert.ok(errs.some((e) => /^MONEY-0: appears in more than one place/.test(e)), JSON.stringify(errs));
});
test("a changed word fails and names the id", () => {
  const errs = run((root) => edit(join(root, "packs/base/rules.yaml"), (s) => s.replace("Must not contain a payment SDK", "Should not contain a payment SDK")));
  assert.ok(errs.some((e) => /^MONEY-0: text hash differs from the snapshot/.test(e)), JSON.stringify(errs));
  if (hasDocs) assert.ok(errs.some((e) => /^MONEY-0: text differs from rules\.md/.test(e)));
});
test("a missing rule fails", () => {
  const errs = run((root) => edit(join(root, "packs/base/rules.yaml"), (s) => s.replace(/- id: MONEY-0\n(?:  .*\n)+/, "")));
  assert.ok(errs.some((e) => /^MONEY-0: .*missing from the packs/.test(e)), JSON.stringify(errs));
});
test("standalone, with no superproject, the snapshot still catches a text edit", () => {
  const c = copy((root, top) => { rmSync(join(top, "docs"), { recursive: true, force: true }); edit(join(root, "packs/constitution/rules.yaml"), (s) => s.replace("Must decline", "May decline")); });
  const r = checkParity(c.root);
  c.done();
  assert.deepEqual(r.skipped, ["skipped: superproject not present"]);
  assert.ok(r.errors.some((e) => /^SCOPE-1: text hash differs/.test(e)), JSON.stringify(r.errors));
});
test("a protected-core rule absent from the protected_core list fails", () => {
  const errs = run((root) => edit(join(root, "packs/base/rules.yaml"), (s) => s.replace("protected_core: [APPEAL-1, ", "protected_core: [")));
  assert.ok(errs.some((e) => /^APPEAL-1: protected .* absent from the protected_core list/.test(e)), JSON.stringify(errs));
});
test("protected_core in the constitution pack fails", () => {
  const errs = run((root) => edit(join(root, "packs/constitution/rules.yaml"), (s) => "protected_core: [SCOPE-1]\n" + s));
  assert.ok(errs.some((e) => /only base may list protected_core/.test(e)), JSON.stringify(errs));
});
test("the protected list is exactly the rights and crisis_safety tiers plus IMPACT-1 and LOC-PRIV-1", () => {
  const { rules, protectedCore } = readPacks(REPO);
  const want = [...rules.values()].filter((r) => ["rights", "crisis_safety"].includes(r.tier) || ["IMPACT-1", "LOC-PRIV-1"].includes(r.id)).map((r) => r.id).sort();
  assert.deepEqual([...protectedCore].sort(), want);
});
