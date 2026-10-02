# Contributing to can_policy

This repo holds the rules the platform runs on. Changes are proposed as pull requests and ratified before they take effect.

## Opening a policy PR

1. Say which rule ids, decision points (DPs) and schemas you change.
2. Give the reason in plain words, and say what problem the change solves.
3. Add motivating examples. They must be fictional or synthetic: no real person, no real incident, no live link to real incident data.
4. Do not edit protected-core rules from here. A PR that touches them is refused.
5. Do not hand edit `manifest.json` or `release.json`. Run `npm run build:pack`.
6. Do not add or edit files in `ratifications/`. Only the approver writes those, and they are never edited after they land.
7. Keep copy free of em and en dashes.

## What CI checks

`npm run verify` runs lint (limits, schema versions, DP and schema completeness, overlay rules, hash drift, ratification records), the rules parity check and the tests. Lint also rejects a ratification record whose hash does not match the pack, or whose pack is fictional or draft. On a PR, CI also runs `node tools/lint-ratifications.mjs --against origin/main` so no existing record is changed.

## What ratification means

A ratification record ties one pack version and hash to the person or group who approved it, an expiry date and a rollback plan. A pack without a valid record does not load on the server. The field reference is in `docs/ratification.md`.

Today: the founder is the interim steward and approves each version. This is a temporary arrangement, it is public, and it ends when a community panel exists. Each approval is logged with the rule ids it touches, who approved it and when it expires. The founder cannot change the protected core. Dissent is recorded with the record.

Later: a randomized review panel ratifies changes, and maintainers only confirm that the checks and process were followed. The method is still an open question (OQ-ratification-method), so the record format keeps a `method` field and works for either.

## Examples and data

Every example, persona and seed is invented. If an example looks like a real person or event, change it before you open the PR.
