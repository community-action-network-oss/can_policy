// Ratification record lint (10-u26). lintRatifications(root, notes, opts) returns readable errors.
// CLI: node tools/lint-ratifications.mjs [root] [--against <git ref>]
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAll } from "./build-pack.mjs";
import { policyVersion } from "./pack-hash.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const validate = new Ajv2020({ allErrors: true }).compile(JSON.parse(readFileSync(join(HERE, "..", "schemas", "ratification.schema.json"), "utf8")));

// Front matter between the first two --- lines. Same subset as can_server reads (no anchors, flow maps, multiline scalars).
export function frontMatter(text) {
  const m = text.replaceAll("\r\n", "\n").match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (!m) return null;
  return parse(m[1]);
}

export function lintRatifications(root, notes = [], { against } = {}) {
  const errors = [];
  const dir = join(root, "ratifications");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")).sort() : [];
  const { outputs } = buildAll(root);
  const built = new Map(outputs.filter((o) => o.data.pack).map((o) => [o.data.pack, o]));
  const packDir = (name) => ((o) => (o ? o.rel.replace(/\/manifest\.json$/, "") : null))(built.get(name));
  const read = (rel) => { try { return parse(readFileSync(join(root, rel), "utf8")) ?? {}; } catch { return {}; } };

  for (const f of files) {
    const rel = `ratifications/${f}`, e = (m) => errors.push(`${rel}: ${m}`);
    let r;
    try { r = frontMatter(readFileSync(join(root, rel), "utf8")); } catch (x) { e(`front matter is not valid YAML (${x.message})`); continue; }
    if (!r) { e("missing --- front matter"); continue; }
    if (!validate(r)) { for (const x of validate.errors) e(`${x.instancePath || "/"} ${x.message}${x.params?.missingProperty ? ` (${x.params.missingProperty})` : ""}`); continue; }
    const semver = r.version.split("@")[1].split("+")[0];
    if (r.version.split("@")[0] !== r.pack) e(`version '${r.version}' does not start with pack '${r.pack}'`);
    if (f !== `${r.pack}-${semver}.md`) e(`file name must be ${r.pack}-${semver}.md`);
    if (!r.version.endsWith("+" + r.pack_hash.slice(0, 12))) e("version suffix is not the first 12 hex of pack_hash");
    if (r.adversarial_gate === "deferred_with_reason" && !r.adversarial_reason) e("adversarial_gate deferred_with_reason needs adversarial_reason");
    if (Date.parse(r.expires_at) < Date.now()) notes.push(`lint: warning: ${rel} expired at ${r.expires_at}`);
    else if (Date.parse(r.expires_at) < Date.parse(r.approved_at)) e("expires_at is before approved_at");

    const o = built.get(r.pack), pd = packDir(r.pack);
    if (!o) { e(`no pack named '${r.pack}'`); continue; }
    // A record is for a real release. Fictional or draft packs must never carry one (FOUNDER-TRANS-1 stays honest).
    const y = read(`${pd}/pack.yaml`), rv = read(`${pd}/reviewer.yaml`);
    if (rv.fictional === true) e(`pack '${r.pack}' is fictional and must never be ratified`);
    if (y.status === "draft") e(`pack '${r.pack}' has status draft and must not carry a ratification record`);
    if (rv.reviewed === false && r.unreviewed_acknowledged !== true) e(`pack '${r.pack}' has reviewed: false, so unreviewed_acknowledged: true is required`);
    // Hash binding: checked for the version in the tree. Older records cannot be rebuilt without their tag.
    if (semver === o.data.version) {
      if (r.pack_hash !== o.data.pack_hash) e(`pack_hash does not match the pack built from the sources (${o.data.pack_hash})`);
      if (r.version !== policyVersion(r.pack, semver, o.data.pack_hash)) e(`version does not match ${policyVersion(r.pack, semver, o.data.pack_hash)}`);
    } else notes.push(`lint: note: ${rel} is for ${semver}, tree is ${o.data.version}; hash not rechecked`);
  }

  if (against) {
    const git = (a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8" });
    try {
      for (const line of git(["diff", "--name-status", "-M", against, "--", "ratifications"]).split("\n").filter(Boolean)) {
        const [s, ...p] = line.split("\t");
        if (s !== "A" && !p.every((x) => x.endsWith(".gitkeep"))) errors.push(`${p.join(" -> ")}: ratification records are append-only (status ${s} against ${against})`);
      }
    } catch (x) { errors.push(`cannot diff ratifications against '${against}': ${String(x.stderr || x.message).trim()}`); }
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), i = args.indexOf("--against");
  const against = i >= 0 ? args[i + 1] : undefined;
  const root = resolve(args.find((a, j) => !a.startsWith("--") && j !== i + 1) ?? join(HERE, ".."));
  const notes = [];
  const errs = lintRatifications(root, notes, { against });
  notes.forEach((n) => console.log(n));
  errs.forEach((x) => console.error("lint-ratifications: " + x));
  console.log(errs.length ? `lint-ratifications: ${errs.length} error(s)` : "lint-ratifications: ok");
  process.exit(errs.length ? 1 : 0);
}
