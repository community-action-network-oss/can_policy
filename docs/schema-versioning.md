# Schema versioning

How a content schema changes without rewriting history. Spec: structured-content.md section 8 and the policy-schema-change flow. Schemas change only through the amendment loop (a PR, eval and replay, ratification, staged rollout).

## Layout
- `content-schemas/<type>/schema.json` is the current version.
- `content-schemas/<type>/versions/<semver>.schema.json` keeps retired versions.
- `content-schemas/<type>/migrations/<from>-to-<to>.json` is the migration map for a major bump. Its format is `schemas/migration-map.schema.json`.

## Semver rules
| Bump | Allowed changes | Required set |
|---|---|---|
| patch | wording, help text, examples | unchanged |
| minor | new optional fields, changed bounds | unchanged |
| major | required fields added or removed | changed, with a migration map |

`npm run lint` diffs `schema.json` against the highest file in `versions/`:
- the version must be higher than the retired one;
- within one major, a changed required set fails (so a new field in a minor bump must be optional);
- a major bump needs a valid migration map named for the two versions, `new_required` lists every newly required field and `dropped` lists every removed one.

## Migration map
`{type, from, to, fields: [{from_path, to_path, transform: copy|split|merge|drop, note}], new_required, dropped}`. The map says how old answers carry over. Applying it to drafts is done by the server and app (plan 10, later units), not by this repo.

## Drafts and published content
- Drafts (`draft`, `in_review`, `needs_revision`) keep their schema version until submit.
- Minor bump: drafts migrate on their own. New optional fields appear empty, changed bounds apply at next submit.
- Major bump: a draft stays on the old version for the grace window, `grace.schema_major_draft_days` in `limits.yaml` (default 30). The poster confirms each mapping, and unmapped required fields are asked fresh. After the window the draft must migrate before submit.
- Published content keeps its schema version and is never rewritten. It gets a non-blocking "predates field Y" marker, never a takedown.

## Rollback
The previous schema version is one config change away: it is still in `versions/`, and the pack version that carried it is still loadable.

## Appeals
The `appeal` schema stays easy on purpose (APPEAL-1, APPEAL-2 are protected core). A change that adds a required appeal field makes appealing harder and is refused in review. Rules are referenced by id, never copied.
