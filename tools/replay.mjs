// Replay diff. Compares recorded decisions (base) with head recordings, offline. Report: docs/replay.md.
// Usage: node tools/replay.mjs [--decisions f.jsonl] [--head-recordings f.jsonl] [--motivating ids.txt]
//        [--legal] [--base <root>] [--head <root>] [--bump minor|patch|major] [--json out.json] [--md out.md]
// Exit: 0 ok, needs_review or no_data; 1 blocked; 2 bad input.
import { parse } from "yaml";
import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRecordings } from "./lib/recordings.mjs";
import { legalFlips } from "./lint-legal-ratification.mjs";
import { buildReport, renderMd, DEFAULT_LIMITS } from "./lib/replay-report.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FX = join(ROOT, "test", "fixtures", "replay");
const FLAGS = ["--decisions", "--head-recordings", "--motivating", "--base", "--head", "--bump", "--json", "--md"];

function loadRules(root, into, core) {
  const files = ["packs/base/rules.yaml", "packs/constitution/rules.yaml"];
  const jd = join(root, "packs", "jurisdictions");
  if (existsSync(jd)) for (const j of readdirSync(jd).sort()) files.push(`packs/jurisdictions/${j}/rules.yaml`);
  for (const f of files) {
    if (!existsSync(join(root, f))) continue;
    const y = parse(readFileSync(join(root, f), "utf8"));
    for (const r of y.rules ?? []) into.set(r.id, { tier: r.tier, enforcement: r.enforcement });
    for (const id of y.protected_core ?? []) core.add(id);
  }
}

function renderLegal(l) {
  if (!l) return "";
  const row = (m) => Object.entries(m).map(([k, v]) => `| ${k} | ${v.flips} |`);
  return ["", "### Legal flips", "", `Past resolutions touched (estimate, ${l.changed_article_basis}): ${l.resolutions_touched}.`, "", "| Layer | Flips |", "|---|---|", ...row(l.by_layer), "", "| Article | Flips |", "|---|---|", ...row(l.by_article), ""].join("\n");
}

function main(argv) {
  const o = { decisions: join(FX, "decisions.jsonl"), "head-recordings": join(FX, "head.jsonl"), head: ROOT, bump: "minor" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--legal") { o.legal = true; continue; }
    if (!FLAGS.includes(argv[i]) || i + 1 >= argv.length) throw new Error(`bad argument ${argv[i]}`);
    o[argv[i].slice(2)] = argv[++i];
  }
  if (!["minor", "patch", "major"].includes(o.bump)) throw new Error(`bad --bump ${o.bump}`);
  const lines = (f) => readFileSync(f, "utf8").split("\n").filter((l) => l.trim());
  const decisions = lines(o.decisions).map((l, i) => { try { return JSON.parse(l); } catch { throw new Error(`${o.decisions} line ${i + 1}: not valid JSON`); } });
  const recs = loadRecordings(o["head-recordings"]);
  const heads = new Map([...recs].map(([id, r]) => [id, r.output]));
  const motivating = new Set(o.motivating ? lines(o.motivating).map((s) => s.trim()) : []);
  const rules = new Map(), core = new Set();
  loadRules(o.head, rules, core);
  if (o.base) loadRules(resolve(o.base), rules, core); // protected ids of either side count
  let limits = { ...DEFAULT_LIMITS };
  const lf = join(o.head, "limits.yaml");
  if (existsSync(lf)) limits = { ...limits, ...(parse(readFileSync(lf, "utf8")).replay_limits ?? {}) };
  const rep = buildReport({ decisions, heads, rules, protectedCore: core, motivating, limits, bump: o.bump });
  if (o.legal) {
    rep.legal = legalFlips(rep.flips, new Map(decisions.map((d) => [d.decision_id, d])), heads, o.base && resolve(o.base), resolve(o.head));
    if (!Object.keys(rep.legal.by_article).length && !rep.legal.resolutions_touched) rep.warnings.push("legal: no decision cites a legal article, so no legal flips could be measured");
  }
  if (o.json) writeFileSync(o.json, JSON.stringify(rep, null, 2) + "\n");
  if (o.md) writeFileSync(o.md, renderMd(rep) + renderLegal(rep.legal));
  if (!o.json && !o.md) console.log(renderMd(rep) + renderLegal(rep.legal));
  else console.log(`replay: ${rep.verdict} (${rep.totals.flips} flips in ${rep.totals.decisions} decisions)`);
  for (const w of rep.warnings) console.warn(`replay warning: ${w}`);
  return rep.verdict === "blocked" ? 1 : 0;
}

try { process.exit(main(process.argv.slice(2))); } catch (e) { console.error(`replay: ${e.message}`); process.exit(2); }
