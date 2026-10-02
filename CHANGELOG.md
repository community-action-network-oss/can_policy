# Changelog

All notable changes to this policy pack repository are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0 candidate] - 2026-10-03

Not ratified. Every pack stays `status: draft`; no record exists in `ratifications/` and no tag is cut (10-u28).

### Evidence
Met on fictional fixtures with recorded responses; no live model has scored this pack. The eval recordings are derived from the expected outcomes (`--derive-fake`), so a pass proves the harness and the thresholds, not model quality.

- `npm run eval -- --derive-fake --strict`: pass, 19 decision points, 314 cases, every DP 6 of 6 threshold checks, nothing loosened.
- `npm run replay` on the 60 fixture decisions: ok, 0 flips (stricter 0, more permissive 0, lateral 0), as required for an initial release.
- `npm run build:pack --check`: no drift. `npm run verify`: green.

### Changed
- Packs base, constitution, fiktiva-city and nl-amsterdam move from 0.1.0 to 1.0.0; `release.json` and the manifests are regenerated.

### Added
- `tools/export-fixture.mjs --out <dir>` writes the released layout `<name>@<semver>/` for can_server, see `docs/release.md` (10-u27).

## [Unreleased]

### Added
- Pack format, JSON schemas, `tools/pack-hash.mjs`, `build:pack`, lint, tests and the CI workflow (10-u03).
