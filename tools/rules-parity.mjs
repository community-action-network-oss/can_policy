// Parity of packs/{base,constitution}/rules.yaml with the rule registry in the superproject docs.
// Usage: node tools/rules-parity.mjs [root] [--update-snapshot]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAP = "ci/fixtures/rules-registry.snapshot.json";
const RETIRED = new Set(["STAGE-1"]); // retired with DP-STAGE; still listed in rules.md
const PACKS = ["base", "constitution"];
const hash = (t) => createHash("sha256").update(t).digest("hex");

// id -> text from the two registry tables, or null when the superproject is absent.
export function readRegistry(root) {
  const dir = join(root, "..", "docs", "spec", "constitution");
  const files = ["rules.md", "rules-legal-sim.md"].map((f) => join(dir, f));
  if (!files.every(existsSync)) return null;
  const reg = new Map();
  for (const f of files)
    for (const l of readFileSync(f, "utf8").replaceAll("\r\n", "\n").split("\n")) {
      const c = /^\| ([A-Z0-9]+(?:-[A-Z0-9]+)+) \|/.test(l) && l.slice(1, -1).split(" | ").map((x) => x.trim());
      if (c && c[0] !== "RULE-ID" && !RETIRED.has(c[0])) reg.set(c[0], c[3]);
    }
  return reg;
}

export function readPacks(root) {
  const rules = new Map(); // id -> {text, pack, ...entry}
  const errors = [];
  let protectedCore = [];
  for (const p of PACKS) {
    const f = join(root, "packs", p, "rules.yaml");
    if (!existsSync(f)) { errors.push(`packs/${p}/rules.yaml: missing`); continue; }
    const y = parse(readFileSync(f, "utf8")) ?? {};
    if (p === "base") protectedCore = y.protected_core ?? [];
    else if (y.protected_core) errors.push(`packs/${p}/rules.yaml: only base may list protected_core`);
    for (const r of y.rules ?? []) {
      if (rules.has(r.id)) errors.push(`${r.id}: appears in more than one place (${rules.get(r.id).pack} and ${p})`);
      rules.set(r.id, { ...r, pack: p });
    }
  }
  return { rules, protectedCore, errors };
}

const diff = (want, got, label) => {
  const errs = [];
  for (const [id, t] of want) {
    if (!got.has(id)) errs.push(`${id}: in ${label} but missing from the packs`);
    else if (got.get(id) !== t) errs.push(`${id}: text differs from ${label}`);
  }
  for (const id of got.keys()) if (!want.has(id)) errs.push(`${id}: in the packs but not in ${label}`);
  return errs;
};

// Protected-core list must equal the rights and crisis_safety tier rules plus rules flagged protected_core.
export function checkProtectedCore({ rules, protectedCore }) {
  const errs = [];
  const listed = new Set(protectedCore);
  for (const id of listed) if (!rules.has(id)) errs.push(`protected_core lists unknown rule ${id}`);
  for (const r of rules.values()) {
    const must = r.tier === "rights" || r.tier === "crisis_safety" || r.protected_core === true;
    if (must && !listed.has(r.id)) errs.push(`${r.id}: protected (tier ${r.tier}) but absent from the protected_core list`);
    if (listed.has(r.id) && !must) errs.push(`${r.id}: in the protected_core list but not flagged protected_core`);
    if (r.protected_core === true && !listed.has(r.id)) errs.push(`${r.id}: flagged protected_core but absent from the list`);
  }
  return errs;
}

// Returns {errors, skipped}.
export function checkParity(root) {
  const { rules, protectedCore, errors } = readPacks(root);
  errors.push(...checkProtectedCore({ rules, protectedCore }));
  const texts = new Map([...rules].map(([id, r]) => [id, r.text]));
  const skipped = [];
  const reg = readRegistry(root);
  if (reg) errors.push(...diff(reg, texts, "rules.md"));
  else skipped.push("skipped: superproject not present");
  const sf = join(root, SNAP);
  if (existsSync(sf)) {
    const hashes = new Map([...texts].map(([i, t]) => [i, hash(t)]));
    errors.push(...diff(new Map(Object.entries(JSON.parse(readFileSync(sf, "utf8")).rules)), hashes, "the snapshot").map((e) => e.replace("text differs", "text hash differs")));
  }
  else errors.push(`${SNAP}: missing, run node tools/rules-parity.mjs --update-snapshot`);
  return { errors, skipped };
}

export function snapshot(root) {
  const { rules } = readPacks(root);
  const o = Object.fromEntries([...rules].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, r]) => [id, hash(r.text)]));
  return JSON.stringify({ rules: o }, null, 2) + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv.find((a, i) => i > 1 && !a.startsWith("--")) ?? join(HERE, ".."));
  if (process.argv.includes("--update-snapshot")) { writeFileSync(join(root, SNAP), snapshot(root)); console.log("rules-parity: snapshot written"); process.exit(0); }
  const { errors, skipped } = checkParity(root);
  skipped.forEach((s) => console.log("rules-parity: " + s));
  errors.forEach((e) => console.error("rules-parity: " + e));
  console.log(errors.length ? `rules-parity: ${errors.length} error(s)` : "rules-parity: ok");
  process.exit(errors.length ? 1 : 0);
}
