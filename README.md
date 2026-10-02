# can_policy

The community-legislated policy pack of the Community Action Network (CAN). A policy pack is the versioned set of platform rules, thresholds, decision-point prompts, content schemas and simulation data that the CAN server loads by version and content hash. Contributors change moderation by pull request here.

All examples in this repository are fictional or synthetic and contain no real people.

## Layout

| Path | Holds |
|---|---|
| `packs/base/` | platform rules and thresholds |
| `packs/constitution/` | constitution rules as a pack layer |
| `packs/jurisdictions/<id>/` | jurisdiction overlays |
| `content-schemas/<type>/` | one versioned schema per content type |
| `decision-points/<DP-id>/` | prompt, output schema, examples and eval sets per decision point |
| `simulation/` | personas, seed scenarios and thresholds (data only) |
| `ratifications/` | ratification records (append-only) |
| `ci/` | CI checks |
| `tools/` | pack tooling, including the pack hash |
| `CHANGELOG.md` | human-readable version history |

Full specification: `docs/design/components/can-policy.md` and `docs/design/ai/policy-pack.md` in the superproject.

## Propose a change

1. Fork and branch.
2. Edit the pack files. Never hand-edit `manifest.json` or `release.json`; they are generated.
3. Run `npm run verify`.
4. Open a pull request. CI runs schema lint, eval against labeled sets and a replay diff. Ratification follows the amendment loop in `docs/design/ai/amendment-loop.md` in the superproject.

## License

MIT, see `LICENSE`.
