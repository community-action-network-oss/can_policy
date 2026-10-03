import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  assert.deepEqual(r.map((x) => x.name), ["base", "constitution", "fiktiva-city", "fiktiva-north"]);
  let parent = null;
  for (const x of r) {
    for (const need of ["pack.yaml", "manifest.json"]) assert.ok(existsSync(join(x.dir, need)), `${x.name} ${need}`);
    const m = JSON.parse(readFileSync(join(x.dir, "manifest.json"), "utf8"));
    const rels = walk(x.dir).filter((f) => isHashed(`p/${f}`, "p"));
    assert.equal(canonicalManifest(x.dir, { files: rels }, parent).pack_hash, m.pack_hash);
    assert.equal(m.pack_hash, x.pack_hash);
    assert.ok(rels.every((f) => !f.startsWith("packs/")), "paths are pack relative");
    if (x.name !== "fiktiva-city") parent = m.pack_hash; // siblings share the constitution parent (fiktiva-north, 10-u67)
  }
  assert.ok(!existsSync(join(out, "nl-amsterdam@1.0.0")));
  assert.equal(exportFixture(REPO, mkdtempSync(join(tmpdir(), "can-exp-")), { withAmsterdam: true }).length, 5);
});

// Independent re-implementation of can_server src/policy/domain/hash.ts (D-83), over the exported dir only.
function serverHash(dir, parent) {
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  const hashed = (p) => {
    const parts = p.split("/");
    if (parts.some((s) => s.startsWith("."))) return false;
    if (parts.length === 1) return !["manifest.json", "release.json", "CHANGELOG.md"].includes(p);
    return !["ratifications", "ci", "tools", "test", "node_modules"].includes(parts[0]);
  };
  const lines = walk(dir).filter(hashed).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map((p) => {
    let b = readFileSync(join(dir, p));
    if (/\.(json|ya?ml|md|txt)$/.test(p)) b = Buffer.from(b.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
    return `${p}\t${sha(b)}`;
  });
  return sha(["parent:" + (parent ?? "none"), ...lines].join("\n"));
}

test("source manifest hash == exported manifest hash == server re-implementation", () => {
  const r = exportFixture(REPO, mkdtempSync(join(tmpdir(), "can-exp-")));
  let parent = null;
  for (const x of r) {
    const src = buildAll(REPO).outputs.find((o) => o.data.pack === x.name).data.pack_hash;
    const committed = JSON.parse(readFileSync(join(REPO, x.name === "base" || x.name === "constitution" ? `packs/${x.name}` : `packs/jurisdictions/${x.name}`, "manifest.json"), "utf8")).pack_hash;
    const exported = JSON.parse(readFileSync(join(x.dir, "manifest.json"), "utf8")).pack_hash;
    const server = serverHash(x.dir, parent);
    assert.deepEqual([src, committed, exported], [server, server, server], x.name);
    if (x.name !== "fiktiva-city") parent = server; // siblings share the constitution parent (fiktiva-north, 10-u67)
  }
  const rel = JSON.parse(readFileSync(join(REPO, "release.json"), "utf8"));
  assert.deepEqual(rel.packs.filter((p) => p.name !== "nl-amsterdam").map((p) => p.pack_hash), r.map((x) => x.pack_hash));
});
