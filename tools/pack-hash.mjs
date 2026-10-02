// The single pack hash tool. Algorithm is the contract with can_server, see README "Hash contract".
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const TEXT = /\.(json|ya?ml|md|txt)$/i;
// Excluded only at the pack root (matches can_server 10-u04). Dotfiles are skipped at any depth.
const EXCLUDED_ROOT = new Set(["manifest.json", "release.json", "CHANGELOG.md", "ratifications", "ci", "tools", "test", "node_modules"]);

export const sha256 = (b) => createHash("sha256").update(b).digest("hex");

// rel is repo relative; packDir is the pack root when rel lives under it, else null.
export function isHashed(rel, packDir = null) {
  const parts = rel.split("/");
  if (parts.some((p) => p.startsWith("."))) return false;
  if (packDir && rel.startsWith(packDir + "/")) return !EXCLUDED_ROOT.has(rel.slice(packDir.length + 1).split("/")[0]);
  return true;
}

// Bytes that are hashed: CRLF becomes LF for text files.
export function hashedBytes(abs, rel) {
  const b = readFileSync(abs);
  return TEXT.test(rel) ? Buffer.from(b.toString("utf8").replaceAll("\r\n", "\n")) : b;
}

export function walk(root, rel = "") {
  const dir = join(root, rel);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const r = rel ? `${rel}/${d.name}` : d.name;
    return d.isDirectory() ? walk(root, r) : [r];
  });
}

const subdirs = (root, rel) =>
  existsSync(join(root, rel)) ? readdirSync(join(root, rel), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name) : [];

// Packs present in the tree. A pack dir counts only if it holds a hashed file.
export function discoverPacks(root) {
  const defs = [
    { layer: "base", id: "base", dir: "packs/base", extra: ["content-schemas", "decision-points", "limits.yaml", "simulation/thresholds.yaml"] },
    { layer: "constitution", id: "constitution", dir: "packs/constitution", extra: [] },
    ...subdirs(root, "packs/jurisdictions").map((id) => ({ layer: "jurisdiction", id, dir: `packs/jurisdictions/${id}`, extra: [] })),
    ...subdirs(root, "packs/local").map((id) => ({ layer: "local", id, dir: `packs/local/${id}`, extra: [] })),
  ];
  return defs
    .map((p) => {
      const files = [p.dir, ...p.extra].flatMap((e) => (e.includes(".") ? (existsSync(join(root, e)) ? [e] : []) : walk(root, e))).filter((f) => isHashed(f, p.dir));
      return { ...p, files };
    })
    .filter((p) => p.files.length > 0 || p.layer === "base" && existsSync(join(root, p.dir, "pack.yaml")));
}

// Sorted by path in byte order.
export function fileEntries(root, rels) {
  return rels
    .map((path) => {
      const b = hashedBytes(join(root, path), path);
      return { path, sha256: sha256(b), bytes: b.length };
    })
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}

export function packHash(entries, parentPackHash = null) {
  const lines = ["parent:" + (parentPackHash ?? "none"), ...entries.map((e) => e.path + "\t" + e.sha256)];
  return sha256(lines.join("\n"));
}

export function canonicalManifest(root, pack, parentPackHash = null) {
  const files = fileEntries(root, pack.files);
  return { files, pack_hash: packHash(files, parentPackHash) };
}

export const policyVersion = (name, semver, hash) => `${name}@${semver}+${hash.slice(0, 12)}`;

export const readPackYaml = (root, pack) => parse(readFileSync(join(root, pack.dir, "pack.yaml"), "utf8"));
