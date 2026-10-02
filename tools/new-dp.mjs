// node tools/new-dp.mjs DP-NAME --rules A,B --outcomes x,y [--mode blocking|async] [--harmful]
import { cpSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// Default runtime floors per outcome. hold is the fail-closed outcome and has none.
const FLOOR = { publish: 0.9, needs_revision: 0.75, reject: 0.92, route_external: 0.9, escalate_human: 0.95 };

function* files(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* files(p); else if (/\.(md|json|ya?ml)$/.test(f)) yield p;
  }
}

export function newDp(root, { name, rules, outcomes, mode = "blocking", harmful = false }) {
  if (!/^DP-[A-Z][A-Z0-9-]*$/.test(name ?? "")) throw new Error(`bad DP name '${name}' (want DP-UPPER-CASE)`);
  if (!rules?.length) throw new Error("--rules is required");
  if (!outcomes?.length) throw new Error("--outcomes is required");
  if (!["blocking", "async"].includes(mode)) throw new Error("--mode must be blocking or async");
  const dest = join(root, "decision-points", name);
  if (existsSync(dest)) throw new Error(`decision-points/${name} already exists`);
  cpSync(join(root, "decision-points", "_template"), dest, { recursive: true });
  const floors = outcomes.filter((o) => FLOOR[o]).map((o) => `${o}: ${FLOOR[o].toFixed(2)}`);
  const fill = (s) => s
    .replace(/^( *)__FLOORS__$/gm, (_, ind) => floors.map((l) => ind + l).join("\n"))
    .replace('["__OUTCOMES__"]', JSON.stringify(outcomes))
    .replaceAll("__OUTCOMES__", outcomes.join(", "))
    .replaceAll("__RULES__", rules.join(", "))
    .replaceAll("__MODE__", mode)
    .replaceAll("__RECALL__", harmful ? "0.98" : "0.90")
    .replaceAll("__DP__", name);
  for (const f of files(dest)) writeFileSync(f, fill(readFileSync(f, "utf8")));
  return dest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [name, ...rest] = process.argv.slice(2);
  const opt = { name, harmful: false };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--rules") opt.rules = rest[++i]?.split(",");
    else if (rest[i] === "--outcomes") opt.outcomes = rest[++i]?.split(",");
    else if (rest[i] === "--mode") opt.mode = rest[++i];
    else if (rest[i] === "--harmful") opt.harmful = true;
    else { console.error(`unknown argument ${rest[i]}`); process.exit(2); }
  }
  try { console.log(`created ${newDp(resolve(HERE, ".."), opt)}\nnext: add examples, then npm run lint and npm run build:pack`); }
  catch (e) { console.error("new-dp: " + e.message); process.exit(1); }
}
