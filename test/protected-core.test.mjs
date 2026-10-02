import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(dirname(fileURLToPath(import.meta.url)), "..", "tools", "protected-core-check.mjs");
const rules = (core, text = "Must hold.", extra = "") => `protected_core: [${core}]
rules:
- {id: P-1, text: "${text}", tier: rights, protected_core: true}
- {id: N-1, text: "Plain.", tier: procedure, protected_core: false}
${extra}`;

function repo(headYaml) {
  const d = mkdtempSync(join(tmpdir(), "pcc-"));
  const g = (...a) => execFileSync("git", ["-C", d, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { stdio: "ignore" });
  g("init", "-q"); mkdirSync(join(d, "packs/base"), { recursive: true });
  writeFileSync(join(d, "packs/base/rules.yaml"), rules("P-1"));
  g("add", "."); g("commit", "-qm", "base");
  writeFileSync(join(d, "packs/base/rules.yaml"), headYaml);
  return d;
}
const run = (d) => spawnSync("node", [TOOL, "--base", "HEAD", "--root", d], { encoding: "utf8" });

test("changed protected text fails with the routing message", () => {
  const d = repo(rules("P-1", "Must not hold."));
  const r = run(d); rmSync(d, { recursive: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /P-1: text changed/);
  assert.match(r.stderr, /route to constitutional amendment \(VIII\.2\)/);
});

test("removed protected rule fails", () => {
  const d = repo("protected_core: []\nrules:\n- {id: N-1, text: \"Plain.\", tier: procedure}\n");
  const r = run(d); rmSync(d, { recursive: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /P-1: removed/);
});

test("new non-core rule and edited non-core rule pass", () => {
  const d = repo(rules("P-1", "Must hold.", "- {id: N-2, text: \"New.\", tier: procedure, protected_core: false}\n").replace("Plain.", "Plain edited."));
  const r = run(d); rmSync(d, { recursive: true });
  assert.equal(r.status, 0, r.stderr);
});

test("workflow parses and names the four jobs; PR template lists the checklist", async () => {
  const { parse } = await import("yaml");
  const { readFileSync } = await import("node:fs");
  const root = join(dirname(TOOL), "..");
  const wf = parse(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"));
  assert.deepEqual(Object.keys(wf.jobs).sort(), ["eval", "protected-core", "replay", "verify"]);
  const tpl = readFileSync(join(root, ".github/pull_request_template.md"), "utf8");
  assert.ok((tpl.match(/^- \[ \] \d\./gm) ?? []).length >= 7);
});
