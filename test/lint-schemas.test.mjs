import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lintSchemas } from "../tools/lint-schemas.mjs";
import { lint } from "../tools/lint.mjs";

const REAL = join(dirname(fileURLToPath(import.meta.url)), "..");
const ui = (w, n = "f") => ({ widget: w, label_msg: `schema.t.${n}.label` });
const good = () => ({
  schema: {
    id: "t", version: "1.0.0", type: "object", required: ["f"],
    properties: { f: { type: "string", minLength: 5, maxLength: 50, "x-ui": ui("text"), "x-guidance": { good: "fine example", bad: "bad example", min_chars: 5, max_chars: 50 }, "x-checks": { dps: ["DP-PRIVACY"] } } },
  },
  messages: { "schema.t.f.label": "A field" },
});
// mutate(files) edits the good case; opts go to lintSchemas
function run(mutate, opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "ls-"));
  try {
    const c = good(); mutate?.(c);
    mkdirSync(join(root, "content-schemas", "t"), { recursive: true });
    writeFileSync(join(root, "content-schemas", "t", "schema.json"), JSON.stringify(c.schema));
    writeFileSync(join(root, "content-schemas", "t", "messages.en.json"), JSON.stringify(c.messages));
    if (c.eval) { mkdirSync(join(root, "decision-points", "DP-PRIVACY", "eval"), { recursive: true }); writeFileSync(join(root, "decision-points", "DP-PRIVACY", "eval", "a.jsonl"), c.eval); }
    writeFileSync(join(root, "dps.md"), "| DP-PRIVACY | DP-TONE |");
    const notes = [];
    return { errors: lintSchemas(root, notes, { dpDoc: join(root, "dps.md"), knownUnused: false, ...opts }), notes };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const has = (r, re) => assert.ok(r.errors.some((e) => re.test(e)), r.errors.join("\n") || "no errors");

test("clean schema passes", () => assert.deepEqual(run().errors, []));
test("unknown widget fails, fallback text passes", () => {
  has(run((c) => { c.schema.properties.f["x-ui"].widget = "wheel"; }), /widget 'wheel'/);
  assert.deepEqual(run((c) => { c.schema.properties.f["x-ui"].widget = "wheel"; c.schema.properties.f["x-ui"].fallback = "text"; }).errors, []);
});
test("widget the app does not render yet is a note, not an error", () => {
  const r = run((c) => { c.schema.properties.f["x-ui"].widget = "stage_ref"; });
  assert.deepEqual(r.errors, []);
  assert.ok(r.notes.some((n) => /stage_ref/.test(n)));
});
test("required property without label or widget fails", () => {
  has(run((c) => { delete c.schema.properties.f["x-ui"].label_msg; }), /no x-ui.label_msg/);
  has(run((c) => { delete c.schema.properties.f["x-ui"]; }), /no x-ui.widget/);
});
test("DP with no directory: allowed when in the design doc, fails when unknown", () => {
  const r = run();
  assert.deepEqual(r.errors, []);
  assert.ok(r.notes.some((n) => /DP-PRIVACY/.test(n)));
  has(run((c) => { c.schema.properties.f["x-checks"].dps.push("DP-NOPE"); }), /DP-NOPE/);
});
test("missing and unused messages fail", () => {
  has(run((c) => { c.messages = {}; }), /'schema.t.f.label' is not in messages/);
  has(run((c) => { c.messages["schema.t.f.extra"] = "x"; }), /'schema.t.f.extra' is not used/);
});
test("group labels count as used", () => {
  assert.deepEqual(run((c) => { c.schema.properties.f["x-ui"].group = "g"; c.messages["schema.t.group.g"] = "G"; }).errors, []);
});
test("guidance example missing from eval fails under strictGuidance", () => {
  has(run((c) => { c.eval = JSON.stringify({ source: "x-guidance:t.f", input: "fine example" }); }, { strictGuidance: true }), /x-guidance.bad is in no/);
  assert.deepEqual(run((c) => { c.eval = JSON.stringify({ input: "fine example" }) + "\n" + JSON.stringify({ input: "bad example" }); }, { strictGuidance: true }).errors, []);
});
test("prose without always-on DPs: note by default, error when strict", () => {
  const f = (c) => { c.schema.properties.f["x-ui"].widget = "textarea"; };
  assert.ok(run(f).notes.some((n) => /textarea/.test(n)));
  has(run(f, { strictAlwaysOn: true }), /always-on/);
});
test("schema bounds drifting from x-guidance fail", () => has(run((c) => { c.schema.properties.f.maxLength = 60; }), /differs from schema/));
test("em or en dash fails", () => has(run((c) => { c.messages["schema.t.f.label"] = "A – field"; }), /em or en dash/));

test("real tree: no errors, and every KNOWN_UNUSED entry is still real", () => {
  const notes = [];
  assert.deepEqual(lintSchemas(REAL, notes), []);
});
test("real tree: full lint still green", () => assert.deepEqual(lint(REAL), []));
