// Protected-core refusal. Usage: node tools/protected-core-check.mjs --base <git ref> [--root <dir>]
// Fails (exit 1) when a protected rule changed text or tier, was removed, or lost protection. Exit 2: bad input.
import { parse } from "yaml";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MSG = "protected core: route to constitutional amendment (VIII.2)";

// Returns Map id -> {text, tier} for protected rules. `read(path)` returns file text or null; `list()` returns rules.yaml paths.
function protectedRules(read, list) {
  const rules = new Map(), ids = new Set();
  for (const f of list()) {
    const src = read(f);
    if (src == null) continue;
    const y = parse(src) ?? {};
    for (const id of y.protected_core ?? []) ids.add(id);
    for (const r of y.rules ?? []) {
      rules.set(r.id, { text: r.text, tier: r.tier });
      if (r.protected_core === true) ids.add(r.id);
    }
  }
  return { rules, ids };
}

export function check(root, base) {
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const gitRead = (p) => { try { return git("show", `${base}:${p}`); } catch { return null; } };
  const baseList = () => git("ls-tree", "-r", "--name-only", base, "--", "packs").split("\n").filter((p) => /^packs\/(?:[^/]+|jurisdictions\/[^/]+|local\/[^/]+)\/rules\.yaml$/.test(p));
  const headList = () => {
    const out = [];
    const walk = (d) => { for (const e of readdirSync(join(root, d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p); else if (e.name === "rules.yaml") out.push(p);
    } };
    if (existsSync(join(root, "packs"))) walk("packs");
    return out;
  };
  const b = protectedRules(gitRead, baseList);
  const h = protectedRules((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : null), headList);
  const problems = [];
  for (const id of [...b.ids].sort()) {
    const was = b.rules.get(id), now = h.rules.get(id);
    if (!now) problems.push(`${id}: removed`);
    else if (!was) continue; // listed but defined nowhere at base: nothing to compare
    else {
      if (was.text !== now.text) problems.push(`${id}: text changed`);
      if (was.tier !== now.tier) problems.push(`${id}: tier changed (${was.tier} -> ${now.tier})`);
      if (!h.ids.has(id)) problems.push(`${id}: no longer protected`);
    }
  }
  return problems;
}

function main(argv) {
  const o = { root: resolve(dirname(fileURLToPath(import.meta.url)), "..") };
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--base", "--root"].includes(argv[i]) || i + 1 >= argv.length) throw new Error(`bad argument ${argv[i]}`);
    o[argv[i].slice(2)] = argv[i + 1];
  }
  if (!o.base) throw new Error("--base <git ref> is required");
  const problems = check(resolve(o.root), o.base);
  if (!problems.length) { console.log(`protected core: unchanged against ${o.base}`); return 0; }
  for (const p of problems) console.error(`  ${p}`);
  console.error(MSG);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) { console.error(`protected-core-check: ${e.message}`); process.exit(2); }
}
