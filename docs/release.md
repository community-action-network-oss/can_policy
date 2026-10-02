# Releasing a pack

Source packs live unversioned in `packs/<name>/`. A release is a directory per pack, `<name>@<semver>/`, which `can_server` reads from its `POLICY_PACKS_DIR`. This repo produces that directory; the server only consumes it (D-82).

## Make the directories

`npm run build:pack` then `npm run export:fixture -- --out <dir> [--with-amsterdam]`. It writes base, constitution and fiktiva-city (nl-amsterdam only with the flag) and prints `name@semver`, `pack_hash`, policy version, one per line.

## Released layout

```
<dir>/<name>@<semver>/
  pack.yaml            name, version, layer, parent as name@semver
  manifest.json        pack_hash, copied from the source manifest; equals the server hash
  rules.yaml           own rules (base, constitution, overlays)
  limits.yaml          base only today
  content-schemas/     base only: <type>/schema.json, messages.en.json
  decision-points/     base only
  ratifications/       records named <pack>-<semver>.md, empty until 10-u28
```

Paths in the directory are relative to the pack, not to the repo. The server hashes every file in the directory except `manifest.json`, `release.json`, `CHANGELOG.md`, `ratifications/**`, `ci`, `tools`, `test`, `node_modules` and dotfiles, so nothing else may be placed in it. The server needs only `pack.yaml` and `manifest.json`; the other files are read when present.

## One hash

Every pack has one `pack_hash` (D-83). Paths are relative to the pack, as the server sees the exported `<name>@<semver>/` directory (`rules.yaml`, `content-schemas/...`). The source `packs/**/manifest.json`, `release.json`, the exported `manifest.json` and ratification records all carry it. The exporter copies the source manifest and fails if the exported directory re-hashes to a different value. `tools/lint-ratifications.mjs` compares a record with this same hash.

## Cutting a tag (after ratification only)

1. Every pack in the chain has `status` other than `draft` and `fictional: false`.
2. `ratifications/<pack>-<semver>.md` exists for each pack, see `docs/ratification.md`.
3. `npm run verify`, `npm run eval -- --strict`, `npm run replay` are green; attach the reports.
4. `npm run build:pack -- --check` shows no drift; export and re-read the printed hashes.
5. The founder tags and pushes. Nothing in a night run tags or pushes.

## How the server pins

The server config names `name`, `semver` and the 64 hex exported `pack_hash`. It refuses a directory whose recomputed hash, `manifest.json` or ratification does not match, and a ratification that is missing or expired. Old versions stay loadable for replays and appeals.
