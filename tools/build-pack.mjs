// Writes manifest.json per pack and release.json, or with --check fails on drift.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverPacks, canonicalManifest, readPackYaml } from "./pack-hash.mjs";

const ORDER = { base: 0, constitution: 1, jurisdiction: 2, local: 3 };
const json = (o) => JSON.stringify(o, null, 2) + "\n";

// Returns {errors, outputs: [{rel, data}]}. Assumes pack.yaml files already passed schema lint.
export function buildAll(root) {
  const errors = [];
  const outputs = [];
  const done = new Map(); // name -> {version, pack_hash}
  const packs = discoverPacks(root).sort((a, b) => ORDER[a.layer] - ORDER[b.layer]);
  for (const p of packs) {
    let y;
    try { y = readPackYaml(root, p); } catch { errors.push(`${p.dir}: pack.yaml missing or unreadable`); continue; }
    let parent = null;
    if (y.parent) {
      const pname = typeof y.parent === "string" ? y.parent.split("@")[0] : y.parent.name; // can_server writes "name@semver"
      const par = done.get(pname);
      if (!par) { errors.push(`${p.dir}: parent pack '${pname}' not found`); continue; }
      parent = { name: pname, version: par.version, pack_hash: par.pack_hash };
    }
    const { files, pack_hash } = canonicalManifest(root, p, parent?.pack_hash ?? null);
    done.set(y.name, { version: y.version, pack_hash });
    outputs.push({ rel: `${p.dir}/manifest.json`, data: { pack: y.name, version: y.version, layer: y.layer, parent, files, pack_hash } });
  }
  const versions = [...new Set([...done.values()].map((d) => d.version))];
  if (versions.length > 1) errors.push(`packs disagree on version: ${versions.join(", ")}`);
  if (done.size) {
    const rel = "release.json";
    const prev = existsSync(join(root, rel)) ? JSON.parse(readFileSync(join(root, rel), "utf8")) : null;
    const packsList = [...done].map(([name, d]) => ({ name, pack_hash: d.pack_hash }));
    const same = prev && prev.version === versions[0] && JSON.stringify(prev.packs) === JSON.stringify(packsList);
    outputs.push({ rel, data: { version: versions[0], packs: packsList, released_at: same ? prev.released_at : new Date().toISOString() } });
  }
  return { errors, outputs };
}

// Drift report: a generated file that differs from what the sources produce.
export function checkAll(root) {
  const { errors, outputs } = buildAll(root);
  for (const o of outputs) {
    const f = join(root, o.rel);
    if (!existsSync(f)) { errors.push(`${o.rel}: missing, run npm run build:pack`); continue; }
    if (readFileSync(f, "utf8") !== json(o.data)) errors.push(`${o.rel}: hash drift, a hashed file changed without npm run build:pack`);
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv.find((a, i) => i > 1 && !a.startsWith("--")) ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
  if (process.argv.includes("--check")) {
    const errs = checkAll(root);
    errs.forEach((e) => console.error("build-pack: " + e));
    process.exit(errs.length ? 1 : 0);
  }
  const { errors, outputs } = buildAll(root);
  if (errors.length) { errors.forEach((e) => console.error("build-pack: " + e)); process.exit(1); }
  outputs.forEach((o) => writeFileSync(join(root, o.rel), json(o.data)));
  console.log(`build-pack: wrote ${outputs.length} files`);
}
