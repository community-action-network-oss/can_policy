// Writes the released layout can_server reads: <out>/<name>@<semver>/ per pack (D-82).
// Source manifests already carry the canonical pack-relative hash (D-83), so the manifest is copied, not recomputed.
// The exported dir is re-hashed as a check.
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverPacks, readPackYaml, canonicalManifest, walk, isHashed, policyVersion } from "./pack-hash.mjs";

const ORDER = { base: 0, constitution: 1, jurisdiction: 2 };
const json = (o) => JSON.stringify(o, null, 2) + "\n";

// Returns [{name, version, dir, pack_hash, policy_version}]. Throws on an unusable tree.
export function exportFixture(root, out, { withAmsterdam = false } = {}) {
  const packs = discoverPacks(root)
    .filter((p) => p.layer in ORDER && (withAmsterdam || p.id !== "nl-amsterdam"))
    .sort((a, b) => ORDER[a.layer] - ORDER[b.layer]);
  const done = new Map();
  const result = [];
  for (const p of packs) {
    const y = readPackYaml(root, p);
    const dest = join(out, `${y.name}@${y.version}`);
    rmSync(dest, { recursive: true, force: true });
    const files = p.files.map((f) => [f, f.startsWith(p.dir + "/") ? f.slice(p.dir.length + 1) : f]);
    for (const [src, rel] of files) {
      mkdirSync(dirname(join(dest, rel)), { recursive: true });
      copyFileSync(join(root, src), join(dest, rel));
    }
    const rdir = join(root, "ratifications");
    mkdirSync(join(dest, "ratifications"), { recursive: true });
    if (existsSync(rdir))
      for (const f of readdirSync(rdir))
        if (f.startsWith(`${y.name}-${y.version}`) && f.endsWith(".md")) copyFileSync(join(rdir, f), join(dest, "ratifications", f));
    let parent = null;
    if (y.parent) {
      parent = done.get(y.parent);
      if (!parent) throw new Error(`${y.name}: parent ${y.parent} is not in this export`);
    }
    const m = JSON.parse(readFileSync(join(root, p.dir, "manifest.json"), "utf8"));
    const rels = walk(dest).filter((f) => isHashed(`p/${f}`, "p"));
    const again = canonicalManifest(dest, { files: rels }, parent?.pack_hash ?? null).pack_hash;
    if (again !== m.pack_hash) throw new Error(`${y.name}: exported dir hashes to ${again}, source manifest says ${m.pack_hash}; run npm run build:pack`);
    writeFileSync(join(dest, "manifest.json"), json(m));
    const pack_hash = m.pack_hash;
    done.set(`${y.name}@${y.version}`, { pack_hash });
    result.push({ name: y.name, version: y.version, dir: dest, pack_hash, policy_version: policyVersion(y.name, y.version, pack_hash) });
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const i = a.indexOf("--out");
  if (i < 0 || !a[i + 1]) { console.error("usage: export-fixture.mjs --out <dir> [--with-amsterdam]"); process.exit(2); }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    for (const r of exportFixture(root, resolve(a[i + 1]), { withAmsterdam: a.includes("--with-amsterdam") }))
      console.log(`${r.name}@${r.version}\t${r.pack_hash}\t${r.policy_version}`);
  } catch (e) { console.error("export-fixture: " + e.message); process.exit(1); }
}
