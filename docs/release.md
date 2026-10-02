# Releasing a pack

Source packs live unversioned in `packs/<name>/`. A release is a directory per pack, `<name>@<semver>/`, which `can_server` reads from its `POLICY_PACKS_DIR`. This repo produces that directory; the server only consumes it (D-82).

## Make the directories

`npm run build:pack` then `npm run export:fixture -- --out <dir> [--with-amsterdam]`. It writes base, constitution and fiktiva-city (nl-amsterdam only with the flag) and prints `name@semver`, `pack_hash`, policy version, one per line.

## Released layout

```
<dir>/<name>@<semver>/
  pack.yaml            name, version, layer, parent as name@semver
  manifest.json        pack_hash equal to the hash the server computes
  rules.yaml           own rules (base, constitution, overlays)
  limits.yaml          base only today
  content-schemas/     base only: <type>/schema.json, messages.en.json
  decision-points/     base only
  ratifications/       records named <pack>-<semver>.md, empty until 10-u28
```

Paths in the directory are relative to the pack, not to the repo. The server hashes every file in the directory except `manifest.json`, `release.json`, `CHANGELOG.md`, `ratifications/**`, `ci`, `tools`, `test`, `node_modules` and dotfiles, so nothing else may be placed in it. The server needs only `pack.yaml` and `manifest.json`; the other files are read when present.

## Two hashes

The `manifest.json` under `packs/**` and `release.json` use repo-relative paths (`packs/base/rules.yaml`). The exported `manifest.json` uses pack-relative paths (`rules.yaml`), so its `pack_hash` is a different value. The server pins the exported one. The exporter prints it; take the pin from there, never from `release.json`.

Open: `tools/lint-ratifications.mjs` compares a record's `pack_hash` with the source manifest, while the server compares it with the exported hash. A record must carry the exported hash to load, so 10-u28 needs either a lint change or one shared path form.

## Cutting a tag (after ratification only)

1. Every pack in the chain has `status` other than `draft` and `fictional: false`.
2. `ratifications/<pack>-<semver>.md` exists for each pack, see `docs/ratification.md`.
3. `npm run verify`, `npm run eval -- --strict`, `npm run replay` are green; attach the reports.
4. `npm run build:pack -- --check` shows no drift; export and re-read the printed hashes.
5. The founder tags and pushes. Nothing in a night run tags or pushes.

## How the server pins

The server config names `name`, `semver` and the 64 hex exported `pack_hash`. It refuses a directory whose recomputed hash, `manifest.json` or ratification does not match, and a ratification that is missing or expired. Old versions stay loadable for replays and appeals.
