import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lint } from "../tools/lint.mjs";
import { buildAll } from "../tools/build-pack.mjs";

const REPO = new URL("..", import.meta.url).pathname;
const P = "packs/jurisdictions/nl-amsterdam";
const has = (errs, re) => assert.ok(errs.some((e) => re.test(e)), `expected ${re}, got ${JSON.stringify(errs)}`);

// Copy of the nl-amsterdam overlay plus the layers it needs, with one file edited, then re-built.
function edit(file, fn) {
  const d = mkdtempSync(join(tmpdir(), "can-unrev-"));
  cpSync(join(REPO, "packs"), join(d, "packs"), { recursive: true });
  const f = join(d, P, file);
  writeFileSync(f, fn(readFileSync(f, "utf8")));
  buildAll(d).outputs.forEach((o) => writeFileSync(join(d, o.rel), JSON.stringify(o.data, null, 2) + "\n"));
  const errs = lint(d);
  rmSync(d, { recursive: true });
  return errs;
}

test("the real nl-amsterdam skeleton lints clean", () => assert.deepEqual(lint(REPO), []));
test("every nl-amsterdam rule is a proposed TODO placeholder", () => {
  const y = readFileSync(join(REPO, P, "rules.yaml"), "utf8");
  assert.equal((y.match(/text: "TODO legal review"/g) ?? []).length, 4);
  assert.equal((y.match(/^  status: proposed/gm) ?? []).length, 4);
});
test("reviewed: false without the banner is refused", () => has(edit("sources.md", (t) => t.replace("Unreviewed.", "")), /unreviewed banner/));
test("a TODO rule that is not proposed is refused", () => has(edit("rules.yaml", (t) => t.replace("\n  status: proposed", "\n  status: active")), /must be status: proposed/));
test("reviewed must be a boolean", () => has(edit("reviewer.yaml", (t) => t.replace("reviewed: false", "reviewed: no_")), /reviewed must be true or false/));
