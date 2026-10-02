import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lint } from "../tools/lint.mjs";
import { buildAll, checkAll } from "../tools/build-pack.mjs";
import { discoverPacks, canonicalManifest } from "../tools/pack-hash.mjs";

const VALID = new URL("./fixtures/valid", import.meta.url).pathname;
const REPO = new URL("..", import.meta.url).pathname;

function broken(mutate) {
  const dir = mkdtempSync(join(tmpdir(), "can-policy-"));
  cpSync(VALID, dir, { recursive: true });
  mutate(dir);
  return dir;
}
const expectError = (dir, re) => {
  const errs = lint(dir);
  rmSync(dir, { recursive: true });
  assert.ok(errs.some((e) => re.test(e)), `expected ${re}, got ${JSON.stringify(errs)}`);
};
const rebuild = (dir) => buildAll(dir).outputs.forEach((o) => writeFileSync(join(dir, o.rel), JSON.stringify(o.data, null, 2) + "\n"));

test("the real repo lints clean", () => assert.deepEqual(lint(REPO), []));
test("the valid fixture lints clean and its manifests are current", () => {
  assert.deepEqual(lint(VALID), []);
  assert.deepEqual(checkAll(VALID), []);
});

test("missing pack.yaml", () => expectError(broken((d) => rmSync(join(d, "packs/base/pack.yaml"))), /packs\/base\/pack\.yaml: missing pack\.yaml/));
test("bad semver", () => expectError(broken((d) => writeFileSync(join(d, "packs/base/pack.yaml"), readFileSync(join(d, "packs/base/pack.yaml"), "utf8").replace("0.1.0", "1.0"))), /fails pack schema/));
test("hash drift", () => expectError(broken((d) => writeFileSync(join(d, "packs/base/rules.yaml"), "# edited without rebuild\n")), /hash drift/));
test("banned dash", () => expectError(broken((d) => { writeFileSync(join(d, "packs/base/rules.yaml"), "# a — b\n"); rebuild(d); }), /em or en dash/));
test("DP dir missing eval", () => expectError(broken((d) => rmSync(join(d, "decision-points/DP-NAMING/eval"), { recursive: true })), /DP-NAMING: missing eval\/thresholds\.yaml/));
test("content schema with unknown top-level x- key", () => expectError(broken((d) => {
  const f = join(d, "content-schemas/problem/schema.json");
  writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), "x-bogus": 1 }));
}), /meta check/));
test("file over 256 KB", () => expectError(broken((d) => writeFileSync(join(d, "limits.yaml"), "a: " + "x".repeat(300000) + "\n")), /larger than 256 KB/));

test("pack hash is stable across CRLF and LF", () => {
  const hashes = [false, true].map((crlf) => {
    const d = broken((dir) => {
      if (!crlf) return;
      const walk = (p) => readdirSync(p).forEach((n) => {
        const f = join(p, n);
        if (statSync(f).isDirectory()) return walk(f);
        if (/\.(json|ya?ml|md)$/.test(n)) writeFileSync(f, readFileSync(f, "utf8").replaceAll("\n", "\r\n"));
      });
      walk(dir);
    });
    const out = discoverPacks(d).map((p) => canonicalManifest(d, p).pack_hash);
    rmSync(d, { recursive: true });
    return out;
  });
  assert.deepEqual(hashes[0], hashes[1]);
});

test("child pack hash depends on the parent hash", () => {
  const p = discoverPacks(VALID)[1];
  assert.notEqual(canonicalManifest(VALID, p, null).pack_hash, canonicalManifest(VALID, p, "ab".repeat(32)).pack_hash);
});
