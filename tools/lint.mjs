// Layout and schema lint. lint(root) returns a list of readable errors.
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverPacks, walk } from "./pack-hash.mjs";
import { checkAll } from "./build-pack.mjs";
import { lintDp } from "./lint-dp.mjs";
import { lintSchemas } from "./lint-schemas.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMAS = join(HERE, "..", "schemas");
const loadSchema = (n) => JSON.parse(readFileSync(join(SCHEMAS, n), "utf8"));
const MAX_BYTES = 256 * 1024;
const BANNED = /[—–]/;

const ajv = new Ajv2020({ allErrors: true });
const packV = ajv.compile(loadSchema("pack.schema.json"));
const metaV = ajv.compile(loadSchema("content-schema.meta.json"));
// Strict compiler for content schemas themselves: x- keys are registered, unknown ones fail.
const contentAjv = new Ajv2020({ strict: true, strictTypes: false });
["version", "pack", "x-ui", "x-guidance", "x-checks", "x-version"].forEach((keyword) => contentAjv.addKeyword({ keyword }));

const limitsV = ajv.compile(loadSchema("limits.schema.json"));
const mapV = ajv.compile(loadSchema("migration-map.schema.json"));
const semverOf = (v) => v.split(".").map(Number);
const cmpSemver = (a, b) => { const [x, y] = [semverOf(a), semverOf(b)]; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

const fmt = (errs) => errs.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
const dirs = (root, rel) => (existsSync(join(root, rel)) ? readdirSync(join(root, rel), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")) : []);

export function lint(root, notes = []) {
  const errors = [];
  const err = (m) => errors.push(m);
  const readJson = (rel) => { try { return JSON.parse(readFileSync(join(root, rel), "utf8")); } catch (e) { err(`${rel}: not valid JSON (${e.message})`); return null; } };

  // 1. pack.yaml per pack
  const packs = discoverPacks(root);
  const names = new Map();
  let packsOk = true;
  for (const p of packs) {
    const rel = `${p.dir}/pack.yaml`;
    if (!existsSync(join(root, rel))) { err(`${rel}: missing pack.yaml`); packsOk = false; continue; }
    let y;
    try { y = parse(readFileSync(join(root, rel), "utf8")); } catch (e) { err(`${rel}: invalid YAML (${e.message})`); packsOk = false; continue; }
    if (!packV(y)) { err(`${rel}: fails pack schema: ${fmt(packV.errors)}`); packsOk = false; continue; }
    if (y.layer !== p.layer) { err(`${rel}: layer '${y.layer}' does not match its directory (${p.layer})`); packsOk = false; }
    if (y.name !== p.id) { err(`${rel}: name '${y.name}' must equal directory id '${p.id}'`); packsOk = false; }
    names.set(y.name, y);
  }
  const versions = new Set([...names.values()].map((y) => y.version));
  if (versions.size > 1) { err(`packs disagree on version (one repo wide semver): ${[...versions].join(", ")}`); packsOk = false; }
  for (const [n, y] of names) {
    if (!y.parent) continue;
    const [pn, pv] = typeof y.parent === "string" ? y.parent.split("@") : [y.parent.name, y.parent.version];
    if (!names.has(pn)) { err(`pack ${n}: parent '${pn}' not found`); packsOk = false; }
    else if (names.get(pn).version !== pv) { err(`pack ${n}: parent version ${pv} does not match ${pn}@${names.get(pn).version}`); packsOk = false; }
  }

  // 1a. overlay rules: a jurisdiction or local pack may add or narrow, never weaken (same refusals as can_server resolveLayers)
  if (packsOk) {
    const ENF = ["advisory", "needs_revision", "reject", "hold"];
    const rulesOf = (p) => { try { return parse(readFileSync(join(root, p.dir, "rules.yaml"), "utf8")) ?? {}; } catch { return {}; } };
    const byName = new Map(packs.map((p) => [p.id, p]));
    const base = byName.has("base") ? rulesOf(byName.get("base")) : {};
    const core = new Set(base.protected_core ?? []);
    for (const p of packs.filter((q) => q.layer === "jurisdiction" || q.layer === "local")) {
      const f = `${p.dir}/rules.yaml`, own = rulesOf(p);
      if (own.protected_core) err(`${f}: only the base pack may list protected_core`);
      const higher = new Map(); // nearest ancestor wins, as in the server merge
      for (let n = names.get(p.id)?.parent, seen = 0; n && seen < 4; seen++) {
        const pn = typeof n === "string" ? n.split("@")[0] : n.name, q = byName.get(pn);
        if (!q) break;
        for (const r of rulesOf(q).rules ?? []) if (!higher.has(r.id)) higher.set(r.id, r);
        n = names.get(pn)?.parent;
      }
      const seenIds = new Set();
      for (const r of own.rules ?? []) {
        if (seenIds.has(r.id)) err(`${f}: duplicate rule ${r.id}`);
        seenIds.add(r.id);
        if (!ENF.includes(r.enforcement)) err(`${f}: ${r.id} has unknown enforcement '${r.enforcement}'`);
        const prev = higher.get(r.id);
        if (r.narrows !== undefined && r.narrows !== r.id) err(`${f}: ${r.id} narrows '${r.narrows}'; a narrowing rule must reuse the id it narrows`);
        if (!prev) { if (r.narrows !== undefined) err(`${f}: ${r.id} narrows a rule that no higher layer has`); continue; }
        if (core.has(r.id)) err(`${f}: ${r.id} touches a protected_core rule`);
        else if (r.narrows !== r.id) err(`${f}: ${r.id} reuses a higher layer id without 'narrows: ${r.id}'`);
        if (r.tier !== prev.tier) err(`${f}: ${r.id} changes the tier (${prev.tier} to ${r.tier})`);
        if (ENF.indexOf(r.enforcement) < ENF.indexOf(prev.enforcement)) err(`${f}: ${r.id} weakens enforcement (${prev.enforcement} to ${r.enforcement})`);
      }
      // a fictional overlay must say so in sources.md
      const rv = join(root, p.dir, "reviewer.yaml");
      if (existsSync(rv) && parse(readFileSync(rv, "utf8"))?.fictional === true && !/invented/i.test(existsSync(join(root, p.dir, "sources.md")) ? readFileSync(join(root, p.dir, "sources.md"), "utf8") : "")) err(`${p.dir}/sources.md: a fictional overlay must state that it is invented`);
    }
  }

  // 2. decision points
  for (const d of dirs(root, "decision-points")) {
    const b = `decision-points/${d.name}`;
    for (const f of ["prompt.md", "schema.json", "eval/thresholds.yaml"]) if (!existsSync(join(root, b, f))) err(`${b}: missing ${f}`);
    for (const f of ["examples", "eval"]) if (!existsSync(join(root, b, f)) || !statSync(join(root, b, f)).isDirectory()) err(`${b}: missing ${f}/ directory`);
    if (existsSync(join(root, b, "schema.json"))) readJson(`${b}/schema.json`);
  }

  // 2a. DP scaffold rules (tools/lint-dp.mjs). Runs where the scaffold exists, so older fixtures without _template are untouched.
  if (existsSync(join(root, "decision-points", "_template"))) errors.push(...lintDp(root, notes));

  // 3. content schemas
  for (const d of dirs(root, "content-schemas")) {
    const rel = `content-schemas/${d.name}/schema.json`;
    if (!existsSync(join(root, rel))) { err(`${rel}: missing`); continue; }
    const s = readJson(rel);
    if (!s) continue;
    if (!metaV(s)) { err(`${rel}: fails content schema meta check: ${fmt(metaV.errors)}`); continue; }
    // "id" is the schema name here, not a legacy $id
    try { contentAjv.compile(Object.fromEntries(Object.entries(s).filter(([k]) => k !== "id"))); } catch (e) { err(`${rel}: not a valid JSON Schema 2020-12 (${e.message})`); }
  }

  // 3a. versioned schemas: versions/<semver>.schema.json holds retired ones, diff against the highest
  for (const d of dirs(root, "content-schemas")) {
    const base = `content-schemas/${d.name}`;
    if (!existsSync(join(root, base, "versions")) || !existsSync(join(root, base, "schema.json"))) continue;
    const cur = readJson(`${base}/schema.json`);
    const olds = readdirSync(join(root, base, "versions")).map((f) => f.match(/^(\d+\.\d+\.\d+)\.schema\.json$/)?.[1]).filter(Boolean).sort(cmpSemver);
    if (!cur || !olds.length) continue;
    const prevV = olds[olds.length - 1], prev = readJson(`${base}/versions/${prevV}.schema.json`);
    if (!prev) continue;
    if (cmpSemver(cur.version, prevV) <= 0) { err(`${base}/schema.json: version ${cur.version} is not higher than retired ${prevV}`); continue; }
    const [a, b] = [new Set(prev.required ?? []), new Set(cur.required ?? [])];
    const added = [...b].filter((x) => !a.has(x)), removed = [...a].filter((x) => !b.has(x));
    if (semverOf(cur.version)[0] === semverOf(prevV)[0]) {
      if (added.length || removed.length) err(`${base}/schema.json: ${prevV} to ${cur.version} changes the required set (${[...added, ...removed].join(", ")}); that needs a major bump`);
      continue;
    }
    const mrel = `${base}/migrations/${prevV}-to-${cur.version}.json`;
    if (!existsSync(join(root, mrel))) { err(`${base}: major bump ${prevV} to ${cur.version} needs ${mrel}`); continue; }
    const m = readJson(mrel);
    if (!m) continue;
    if (!mapV(m)) { err(`${mrel}: fails migration map schema: ${fmt(mapV.errors)}`); continue; }
    if (m.type !== d.name || m.from !== prevV || m.to !== cur.version) err(`${mrel}: type, from and to must be ${d.name}, ${prevV}, ${cur.version}`);
    for (const x of added) if (!m.new_required.includes(x)) err(`${mrel}: new required field '${x}' is missing from new_required`);
    for (const x of removed) if (!m.dropped.includes(x)) err(`${mrel}: removed required field '${x}' is missing from dropped`);
  }

  // 3b. limits.yaml: schema, min <= max, and agreement with content schema x-guidance
  if (existsSync(join(root, "limits.yaml"))) {
    let L = null;
    try { L = parse(readFileSync(join(root, "limits.yaml"), "utf8")); } catch (e) { err(`limits.yaml: invalid YAML (${e.message})`); }
    if (L && !limitsV(L)) err(`limits.yaml: fails limits schema: ${fmt(limitsV.errors)}`);
    else if (L) {
      for (const [type, fields] of Object.entries(L.fields)) {
        for (const [field, b] of Object.entries(fields)) {
          const [lo, hi] = field === "list" ? ["min", "max"] : ["min_chars", "max_chars"];
          if (b[lo] !== undefined && b[hi] !== undefined && b[lo] > b[hi]) err(`limits.yaml: fields.${type}.${field}: ${lo} is greater than ${hi}`);
        }
        const sp = join(root, "content-schemas", type, "schema.json");
        if (!existsSync(sp)) continue; // no schema yet: nothing to compare
        let s; try { s = JSON.parse(readFileSync(sp, "utf8")); } catch { continue; } // reported in check 3
        for (const [field, b] of Object.entries(fields)) {
          if (field === "list") continue; // list bounds have no single schema counterpart yet
          const prop = s.properties?.[field];
          if (!prop) { err(`limits.yaml: fields.${type}.${field} has no property '${field}' in content-schemas/${type}/schema.json`); continue; }
          const g = prop["x-guidance"] ?? {};
          for (const k of ["min_chars", "max_chars"]) if (b[k] !== undefined && b[k] !== g[k]) err(`limits.yaml: fields.${type}.${field}.${k} is ${b[k]} but x-guidance says ${g[k]}`);
        }
      }
    }
  }

  // 3c. content schema completability (tools/lint-schemas.mjs)
  // Same gate as 2a: fixtures without the _template scaffold are older minimal trees.
  if (existsSync(join(root, "decision-points", "_template"))) errors.push(...lintSchemas(root, notes));

  // 4. size and banned characters (fixtures are inputs of the tests, not repo content)
  for (const f of walk(root)) {
    if (f.startsWith("node_modules/") || f.startsWith(".git/") || f.startsWith("test/fixtures/") || f === "package-lock.json" || f.startsWith(".")) continue;
    if (statSync(join(root, f)).size > MAX_BYTES) err(`${f}: larger than 256 KB`);
    if (/\.(md|ya?ml|json)$/.test(f) && BANNED.test(readFileSync(join(root, f), "utf8"))) err(`${f}: contains an em or en dash (U+2014 or U+2013)`);
  }

  // 5. generated files match sources
  if (packsOk) errors.push(...checkAll(root).map((m) => `${m}`));
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? join(HERE, ".."));
  const notes = [];
  const errs = lint(root, notes);
  notes.forEach((n) => console.log(n));
  errs.forEach((e) => console.error("lint: " + e));
  console.log(errs.length ? `lint: ${errs.length} error(s)` : "lint: ok");
  process.exit(errs.length ? 1 : 0);
}
