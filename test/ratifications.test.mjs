import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lint } from "../tools/lint.mjs";
import { buildAll } from "../tools/build-pack.mjs";
import { lintRatifications, frontMatter } from "../tools/lint-ratifications.mjs";

const VALID = new URL("./fixtures/valid", import.meta.url).pathname;
const REPO = new URL("..", import.meta.url).pathname;
const DOC = readFileSync(join(REPO, "docs/ratification.md"), "utf8");
const EXAMPLE = DOC.match(/```yaml\n(---\n[\s\S]*?\n---[\s\S]*?)```/)[1];
const has = (errs, re) => assert.ok(errs.some((e) => re.test(e)), `expected ${re}, got ${JSON.stringify(errs)}`);
const write = (d) => buildAll(d).outputs.forEach((o) => writeFileSync(join(d, o.rel), JSON.stringify(o.data, null, 2) + "\n"));

// A tree with a non-draft base pack and a record for it. mut edits the front matter object text.
function tree({ mut = (t) => t, name, status = "ratified", reviewer } = {}) {
  const d = mkdtempSync(join(tmpdir(), "can-rat-"));
  cpSync(VALID, d, { recursive: true });
  const py = join(d, "packs/base/pack.yaml");
  writeFileSync(py, readFileSync(py, "utf8").replace("status: draft", `status: ${status}`));
  if (reviewer) writeFileSync(join(d, "packs/base/reviewer.yaml"), reviewer);
  write(d);
  const m = JSON.parse(readFileSync(join(d, "packs/base/manifest.json"), "utf8"));
  const v = `base@${m.version}+${m.pack_hash.slice(0, 12)}`;
  const rec = EXAMPLE.replace("example-city@0.2.0+0123456789ab", v).replace("0123456789abcdef".repeat(4), m.pack_hash)
    .replace('pack: "example-city"', 'pack: "base"').replace("2030-07-15", "2099-07-15");
  mkdirSync(join(d, "ratifications"), { recursive: true });
  writeFileSync(join(d, "ratifications", name ?? `base-${m.version}.md`), mut(rec));
  return d;
}
const run = (opts, o) => { const d = tree(opts); const notes = []; const e = lintRatifications(d, notes, o); rmSync(d, { recursive: true }); return { e, notes }; };

test("the doc example passes the schema", () => assert.ok(frontMatter(EXAMPLE).pack === "example-city"));
test("a valid record passes, and the full lint stays clean", () => {
  const d = tree(); assert.deepEqual(lint(d), []); rmSync(d, { recursive: true });
});
test("the real repo has no records and lints clean", () => assert.deepEqual(lint(REPO), []));
test("each missing required field fails", () => {
  for (const f of Object.keys(frontMatter(EXAMPLE)).filter((k) => k !== "unreviewed_acknowledged")) {
    const { e } = run({ mut: (t) => t.replace(new RegExp(`^${f}:.*\\n(  .*\\n)*`, "m"), "") });
    has(e, new RegExp(f));
  }
});
test("missing approved_by or expires_at is an error", () => {
  has(run({ mut: (t) => t.replace(/^approved_by:.*\n/m, "") }).e, /approved_by/);
  has(run({ mut: (t) => t.replace(/^expires_at:.*\n/m, "") }).e, /expires_at/);
});
test("a wrong hash fails", () => has(run({ mut: (t) => t.replace(/^pack_hash: "[0-9a-f]{4}/m, 'pack_hash: "ffff') }).e, /does not match|version suffix/));
test("a bad date and protected_core_check false fail", () => {
  has(run({ mut: (t) => t.replace("2030-01-15", "15/01/2030") }).e, /approved_at/);
  has(run({ mut: (t) => t.replace("protected_core_check: true", "protected_core_check: false") }).e, /protected_core_check/);
});
test("a wrong file name fails", () => has(run({ name: "base-9.9.9.md" }).e, /file name must be/));
test("expired is a warning, not an error", () => {
  const { e, notes } = run({ mut: (t) => t.replace("2099-07-15", "2026-01-01") });
  assert.deepEqual(e, []); assert.ok(notes.some((n) => /expired/.test(n)));
});
test("deferred adversarial gate needs a reason", () => has(run({ mut: (t) => t.replace('"passed"', '"deferred_with_reason"') }).e, /adversarial_reason/));
test("a draft pack and a fictional pack are never ratified", () => {
  has(run({ status: "draft" }).e, /status draft/);
  has(run({ reviewer: "reviewer: none\nfictional: true\n" }).e, /fictional/);
});
test("reviewed: false needs unreviewed_acknowledged", () => {
  const rv = "reviewer: none\nreviewed: false\n";
  has(run({ reviewer: rv, mut: (t) => t.replace(/^unreviewed_acknowledged:.*\n/m, "") }).e, /unreviewed_acknowledged/);
  has(run({ reviewer: rv, mut: (t) => t.replace("unreviewed_acknowledged: true", "unreviewed_acknowledged: false") }).e, /unreviewed_acknowledged/);
  assert.deepEqual(run({ reviewer: rv }).e, []);
});

test("append-only: adding passes, editing or deleting fails against a base ref", () => {
  const d = tree();
  const g = (...a) => execFileSync("git", ["-C", d, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" });
  const f = join(d, "ratifications", readFileSync(join(d, "packs/base/manifest.json"), "utf8") && `base-0.1.0.md`);
  const body = readFileSync(f, "utf8");
  rmSync(f);
  g("init", "-q", "-b", "main"); g("add", "-A"); g("commit", "-q", "-m", "base");
  writeFileSync(f, body);
  assert.deepEqual(lintRatifications(d, [], { against: "main" }), []); // new record is an add
  g("add", "-A"); g("commit", "-q", "-m", "add record");
  writeFileSync(f, body + "edited\n");
  has(lintRatifications(d, [], { against: "HEAD" }), /append-only/);
  rmSync(f);
  has(lintRatifications(d, [], { against: "HEAD" }), /append-only/);
  has(lintRatifications(d, [], { against: "nope" }), /cannot diff/);
  rmSync(d, { recursive: true });
});
