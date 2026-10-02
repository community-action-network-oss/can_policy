import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAll, checkAll } from "../tools/build-pack.mjs";
import { exportFixture } from "../tools/export-fixture.mjs";
import { canonicalManifest, walk, isHashed } from "../tools/pack-hash.mjs";

const REPO = new URL("..", import.meta.url).pathname;
const VALID = join(REPO, "test/fixtures/valid");
const tree = () => { const d = mkdtempSync(join(tmpdir(), "can-build-")); cpSync(VALID, d, { recursive: true }); return d; };
const hashes = (d) => Object.fromEntries(buildAll(d).outputs.filter((o) => o.data.pack_hash).map((o) => [o.data.pack, o.data.pack_hash]));

test("the real tree is a v1 candidate with no drift", () => {
  assert.deepEqual(checkAll(REPO), []);
  const rel = JSON.parse(readFileSync(join(REPO, "release.json"), "utf8"));
  assert.equal(rel.version, "1.0.0");
});

test("building twice gives identical hashes", () => {
  const d = tree();
  assert.deepEqual(hashes(d), hashes(d));
  assert.deepEqual(hashes(REPO), hashes(REPO));
});

test("one changed byte in a schema changes pack_hash and the version suffix", () => {
  const d = tree();
  const before = hashes(d).base;
  const f = join(d, "content-schemas/problem/schema.json");
  writeFileSync(f, readFileSync(f, "utf8") + " ");
  const after = hashes(d).base;
  assert.notEqual(before, after);
  assert.notEqual(before.slice(0, 12), after.slice(0, 12));
});

test("exported tree reloads to the manifest hash, parents chain, amsterdam is opt-in", () => {
  const out = mkdtempSync(join(tmpdir(), "can-exp-"));
  const r = exportFixture(REPO, out);
  assert.deepEqual(r.map((x) => x.name), ["base", "constitution", "fiktiva-city"]);
  let parent = null;
  for (const x of r) {
    for (const need of ["pack.yaml", "manifest.json"]) assert.ok(existsSync(join(x.dir, need)), `${x.name} ${need}`);
    const m = JSON.parse(readFileSync(join(x.dir, "manifest.json"), "utf8"));
    const rels = walk(x.dir).filter((f) => isHashed(`p/${f}`, "p"));
    assert.equal(canonicalManifest(x.dir, { files: rels }, parent).pack_hash, m.pack_hash);
    assert.equal(m.pack_hash, x.pack_hash);
    assert.ok(rels.every((f) => !f.startsWith("packs/")), "paths are pack relative");
    parent = m.pack_hash;
  }
  assert.ok(!existsSync(join(out, "nl-amsterdam@1.0.0")));
  assert.equal(exportFixture(REPO, mkdtempSync(join(tmpdir(), "can-exp-")), { withAmsterdam: true }).length, 4);
});
