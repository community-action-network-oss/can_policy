// Seeded attack-variant generator (11-u04). Stdlib plus yaml. TEST DATA ONLY: every identifier it plants is invented.
// node tools/gen-attacks.mjs --persona adv-doxx|adv-inject|adv-spam|adv-hate|adv-brigade|adv-offtopic|adv-individual|adv-crisis-bait|adv-assumption-smuggle|adv-schema-bypass --seed N [--out file]   (no --out: stdout)
// Reads simulation/personas/<id>/templates.yaml and wordlists/*.txt. One JSONL row per variant:
// {id, family, technique, field_ref, payload, planted_canaries[], expected_outcome, rule_ids}
// Optional per-technique keys: skip_until, endpoint, expect_status (copied to the row), accounts + window_ms (row gets account sim-<persona>-NN and offset_ms).
// payload is a string, or an array of strings when field_ref is "a+b" (split across fields).
import { parse } from "yaml";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// mulberry32: tiny deterministic PRNG.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const LOOK = { a: "а", e: "е", o: "о", p: "р", c: "с", x: "х", i: "і" };
const rot13 = (s) => s.replace(/[a-z]/gi, (c) => { const b = c <= "Z" ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b); });
// Filters turn a plain slot value into the form that is planted. Chainable: {phone|digits|spell}.
export const FILTERS = {
  lower: (s) => s.toLowerCase(),
  upper: (s) => s.toUpperCase(),
  url: (s) => encodeURIComponent(s),
  b64: (s) => Buffer.from(s, "utf8").toString("base64"),
  rot13,
  zw: (s) => [...s].join("​"),
  homoglyph: (s) => [...s].map((c) => LOOK[c] ?? c).join(""),
  spaced: (s) => [...s].join(" "),
  digits: (s) => s.replace(/\D/g, ""),
  spell: (s) => [...s].map((c) => (/\d/.test(c) ? words[+c] : c)).join(" "),
  dots: (s) => s.replace(/@/g, " at ").replace(/\./g, " dot "),
  nospace: (s) => s.replace(/\s+/g, ""),
  rep150: (s) => s.repeat(150), // oversize fields (adv-schema-bypass)
  rep400: (s) => s.repeat(400),
  leet: (s) => s.replace(/[aeiost]/gi, (c) => ({ a: "4", e: "3", i: "1", o: "0", s: "5", t: "7" })[c.toLowerCase()]),
};

export function generate(persona, seed, root = ROOT) {
  const dir = join(root, "simulation", "personas", persona);
  const tpl = parse(readFileSync(join(dir, "templates.yaml"), "utf8"));
  const wl = {};
  for (const f of readdirSync(join(dir, "wordlists")).sort()) wl[f.replace(/\.txt$/, "")] = readFileSync(join(dir, "wordlists", f), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const rnd = prng(seed);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const digs = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join("");
  const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("");
  const pad = (n) => String(n).padStart(2, "0");

  // Slot factories. All values are invented: fictional wordlists, reserved or invalid number ranges, fake hosts only.
  const make = {
    first: () => pick(wl.first), last: () => pick(wl.last), title: () => pick(wl.title),
    name: (v) => `${v("first")} ${v("last")}`,
    titled: (v) => `${v("title")} ${v("first")} ${v("last")}`,
    street: () => pick(wl.street), employer: () => pick(wl.employer), role: () => pick(wl.role),
    place: () => pick(wl.place), time: () => pick(wl.time), sensitive: () => pick(wl.sensitive),
    addr: (v) => `${1 + Math.floor(rnd() * 98)} ${v("street")} ${pick(wl.streettype)}`,
    postcode: () => `ZZ${1 + Math.floor(rnd() * 9)} ${1 + Math.floor(rnd() * 9)}ZZ`, // ZZ is not a real postcode area
    plate: () => `ZZ-${digs(3)}-SIM`,
    tail: () => digs(3),
    phone: (v) => `07700 900${v("tail")}`, // Ofcom drama range
    phone_intl: (v) => `+44 7700 900${v("tail")}`,
    phone_dashed: (v) => `07700-900-${v("tail")}`,
    email: (v) => `${v("first").toLowerCase()}.${v("last").toLowerCase()}@evidence.sim.test`,
    email_alt: (v) => `${v("first").toLowerCase()}${v("last").toLowerCase()}@example.test`,
    ni: () => `QQ${digs(6)}C`, // QQ is never issued
    dob: () => `19${50 + Math.floor(rnd() * 50)}-${pad(1 + Math.floor(rnd() * 12))}-${pad(1 + Math.floor(rnd() * 28))}`,
    handle: (v) => `@${v("first").toLowerCase()}_${v("last").toLowerCase()}${digs(2)}_sim`,
    w3w: () => `///${pick(wl.w3w)}.${pick(wl.w3w)}.${pick(wl.w3w)}`, // invented words, no real location
    iban: () => `GB00 ZZZZ ${digs(4)} ${digs(4)} ${digs(4)} ${digs(2)}`, // check digits 00 never validate
    card: () => pick(["4000 0000 0000 0002", "4242 4242 4242 4242", "5555 5555 5555 4444"]), // public processor test numbers
    canary: () => `CANARY-${hex(8)}`,
    phrase: () => pick(wl.phrase),
    topic: () => pick(wl.topic),
    num: () => String(2 + Math.floor(rnd() * 97)),
    link: () => `https://evidence.sim.test/promo/${pick(wl.slug)}-${digs(3)}`,
  };

  const rows = [];
  for (const t of tpl.techniques) {
    const seen = new Set();
    for (let i = 0, tries = 0; i < t.count && tries < t.count * 50; tries++) {
      const cache = {}, used = [], planted = {};
      const v = (k) => { const f = make[k] ?? (wl[k] && (() => pick(wl[k]))); if (!f) throw new Error(`templates.yaml: unknown slot {${k}}`); return (cache[k] ??= f(v)); /* no factory: falls back to wordlists/<slot>.txt */ };
      const render = (s) => s.replace(/\{([a-z0-9_]+)((?:\|[a-z0-9]+)*)\}/g, (_, slot, fs) => {
        const plain = v(slot);
        if (!used.includes(slot)) used.push(slot);
        const out = fs ? fs.slice(1).split("|").reduce((x, f) => FILTERS[f](x), plain) : plain;
        if (out !== plain) planted[slot] = out;
        return out;
      });
      const t0 = t.templates[tries % t.templates.length];
      const ref = pick(t.field_refs);
      const payload = Array.isArray(t0) ? t0.map(render) : render(t0);
      const key = JSON.stringify(payload);
      if (seen.has(key)) continue;
      seen.add(key);
      i++;
      const canaries = [];
      for (const s of used) { const p = cache[s]; if (!canaries.includes(p)) canaries.push(p); if (planted[s] && !canaries.includes(planted[s])) canaries.push(planted[s]); }
      const row = {
        id: `${persona}-${t.id}-${String(i).padStart(2, "0")}`, family: persona, technique: t.id,
        field_ref: Array.isArray(ref) ? ref.join("+") : ref, payload, planted_canaries: canaries,
        expected_outcome: t.expected_outcome, rule_ids: t.rule_ids,
      };
      if (t.skip_until) row.skip_until = t.skip_until;
      for (const k of ["endpoint", "expect_status"]) if (t[k] !== undefined) row[k] = t[k]; // raw_http rows (adv-schema-bypass)
      if (t.accounts) { row.account = `sim-${persona}-${pad(((i - 1) % t.accounts) + 1)}`; row.offset_ms = Math.floor(rnd() * t.window_ms); }
      rows.push(row);
    }
  }
  // Non-ASCII (zero-width, look-alike letters) is written as \uXXXX so a reviewer can see it.
  return rows.map((r) => JSON.stringify(r).replace(/[\u0080-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))).join("\n") + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1]; };
  const persona = arg("--persona"), seed = Number(arg("--seed")), out = arg("--out");
  if (!["adv-doxx", "adv-inject", "adv-spam", "adv-hate", "adv-brigade", "adv-offtopic", "adv-individual", "adv-crisis-bait", "adv-assumption-smuggle", "adv-schema-bypass"].includes(persona) || !Number.isInteger(seed)) { console.error("usage: gen-attacks.mjs --persona <adv-id> --seed N [--out file]"); process.exit(2); }
  const text = generate(persona, seed);
  if (out) writeFileSync(out, text); else process.stdout.write(text);
}
