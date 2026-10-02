# Legal corpora

How the legal stack (D-61, ADR 0012) lives in can_policy. This unit (10-u41) defines the format and its lint. It holds no real legal text. Fixtures under `test/fixtures/legal` are invented for the fictional Fiktiva City.

## Layout

```
packs/legal/<layer dir>/<jurisdiction>/<corpus...>/
  pack.yaml  corpus.yaml  topic-index.json
  sources/   the vendored official file, unmodified
  articles/  <article-key>.md
  review/    review records
```

Layer dirs: `L1-un`, `L2-supranational`, `L3-constitution`, `L4-national`, `L5-regional`, `L6-city`. L0 is the base pack and has no corpus. Every directory holding `corpus.yaml` or `pack.yaml` is one pack (the corpus root). Its id is the path after the layer dir joined with `-`, for example `packs/legal/L2-supranational/nl/echr` has id `nl-echr`. Article ids are `<L#>/<jurisdiction>/<corpus path>/<article-key>`, for example `L2/nl/echr/art-10`.

## Pack kind and hashing

`pack.yaml` uses `layer: legal`, `parent: null`, a `jurisdiction`, and `name` equal to the corpus id. Its `version` and `effective_from` must equal `corpus.yaml`.

The hash algorithm is unchanged (README "Hash contract"): byte-order sort, CRLF to LF for text files, root-only exclusions, dotfiles excluded, `parent:none` header line. The pack root is the corpus directory, so `sources/`, `articles/`, `topic-index.json`, `review/` and `corpus.yaml` are all hashed; one changed article byte moves `content_hash` and the pack hash.

Differences from other pack kinds, all in the builder and not in the hash:
- A legal pack has its own `version` and is not part of the repo wide semver agreement.
- A legal pack gets its own `manifest.json` but is not listed in `release.json`. A corpus is pinned by `{id, version, pack_hash}` (the pin field is added by 10-u53).

Required server change (can_server is not edited here): none for the hash itself, since a corpus directory is just a pack root with `parent: null`. The server loader (10-u55) must accept `layer: legal` in pack.yaml and manifest.json (the unused `schemas/manifest.schema.json` layer enum does not list `legal` yet; add it with the loader), must not require legal packs to share the repo semver, and must not expect them in `release.json`.

## Corpus version string

`corpus_version` in a problem's `legal_stack[]` item is `<corpus id>@<semver>+<first 12 hex of pack_hash>`, for example `nl-echr@1.0.0+0123456789ab`. This is the existing `policyVersion()` format, at most 64 characters (the field limit; the id is capped at 40). The layer is carried separately in the item's `layer` (`L1` to `L6`).

## corpus.yaml (LEGAL-SOURCE-1)

Required: `id`, `layer`, `jurisdiction`, `instrument`, `official_publisher`, `source_url`, `retrieval_date`, `version`, `effective_from`, `effective_to` (null when in force), `language` (the authoritative one), `license`, `content_hash`, `status` (`index_only|draft|ratified`), `reviewed` (bool), `reviewer` (`none` or `{name, qualification, date, scope}`). Optional: `translations[]` (each `translation: true`, never the cited text), `mode` (`binding|reference`, default per jurisdiction), `fictional`.

`content_hash` is sha256 over the concatenated article bodies in article key byte order. Quote it in YAML: an unquoted all digit or `e` containing hash can parse as a number.

## Articles

Frontmatter: `article_id`, `article_key` (equals the file name), `heading`, `language` (must equal the corpus language), `source_locator` (page, section or anchor in `sources/`), `text_sha256`. The body is the official text verbatim: every byte after the closing `---` line, with CRLF read as LF. `text_sha256` is sha256 of exactly that body. `topic_ban` is never set in an article.

## Topic index

`topic-index.json` is an array of `{article_id, topics, actors, actions, constraint_kinds, always_for_dps, topic_ban, ban_scope}`. Every article has exactly one entry and every entry resolves to an article. `topic_ban: true` needs `ban_scope` (topic ids) and `reviewed: true` on the corpus (used by 09-u58).

## Lint (tools/lint-legal.mjs, wired into tools/lint.mjs)

Fails on: missing provenance field, schema violations, layer or jurisdiction or id not matching the path, `content_hash` or `text_sha256` mismatch, an article without `source_locator`, a translation used as authority, a missing topic index or coverage gap, `topic_ban` on an unreviewed corpus, `reviewed: true` or `status: ratified` without a complete review record, and `ratified` with `reviewer: none`.

Exemptions, because official text is verbatim: the banned dash check and the 256 KB cap skip `packs/legal/**/articles/**`; `packs/legal/**/sources/**` skips the dash check and has a 1 MB cap per file. The dash check still applies to `corpus.yaml`, `topic-index.json`, `review/` and these docs.

## Proposing a change

Open a PR that adds or edits the vendored source, the articles, the topic index and `corpus.yaml` provenance together, raises `version`, adds a review record, and runs `npm run build:pack`. A text edit without a version bump and review record is rejected by review (LEGAL-CORPUS-1). Never paste text from a translation or summary.

## What a reviewer signs

A review record is `review/<date>.md` with frontmatter `reviewer`, `qualification` (the reviewer's qualification for this jurisdiction), `scope` (articles or layers covered), `date`. It states that the articles match the official source at the stated version. Only then may `reviewed: true` and `status: ratified` be set.

## Ingest tool (tools/legal-ingest.mjs, 10-u42)

`node tools/legal-ingest.mjs <corpus-dir>` (or `npm run legal:ingest -- <corpus-dir>`) turns the vendored official file into `articles/*.md`, a `corpus.yaml` skeleton and a draft `topic-index.json`. It has no network code and no model, and it refuses any URL argument. `--check` writes nothing and fails when the tree differs from what the source produces (an edited source, an edited or stale article, a moved `content_hash`). Re-running on an unchanged tree changes no byte.

The corpus dir must sit at `packs/legal/<L#-name>/<jurisdiction>/<corpus...>`; layer, jurisdiction, corpus id and article ids come from that path.

### Vendoring procedure (a human, or an interactive session with network)

1. Download the official file from the official publisher. Do not edit it, do not use a translation as the authority.
2. Save it as `sources/<file>` in the corpus dir.
3. Write `sources/source.yaml` and record the retrieval date and the file's `sha256` in it (`shasum -a 256 <file>`). Commit both before running the tool.
4. Run the tool, review the output, add `topics.seed.yaml` if wanted, run `npm run build:pack` and `npm run verify`.

### sources/source.yaml

Required: `file` (path inside `sources/`), `format` (`txt` or `html`), `instrument`, `version`, `effective_from`, `official_publisher`, `source_url`, `retrieval_date`, `license`, and `split`. The tool refuses to run when publisher, URL, retrieval date or license is missing; these are copied, never invented. Optional: `sha256` (checked against the file), `effective_to`, `mode`, `translations`, `fictional`.

`split` holds `heading` (regex tested on each line, article headings), `number_group` (capture group holding the article number, default 1), `chapter` (optional regex; a chapter line ends the previous article and is not copied into any article, its first group is recorded in `source_locator`), and `language`.

### What the tool does and does not change

- Text before the first heading and chapter lines belong to no article. Every article body is the source text from its heading line up to the next heading or chapter line, with CRLF read as LF and nothing else changed.
- `html`: scripts, styles and comments are dropped, block tags become line breaks, other tags are removed, entities are decoded. HTML whitespace rules apply (runs of spaces collapse, blank lines vanish). Words are never touched.
- `article_key` is `art-` plus the lowercased number. A duplicated key, or no heading match, stops the run.
- `source_locator` is `sources/<file>[, chapter <c>], bytes <from>-<to>` of the LF text (for html, of the extracted text).
- Written once and then kept: `corpus.yaml` (later runs move only `content_hash`) and `pack.yaml`. A new `corpus.yaml` is `status: draft`, `reviewed: false`, `reviewer: none`.
- Draft topic index: `topics` come from whole word, case-insensitive matches of `topics.seed.yaml` (`topics: {topic-id: [words]}`) against the article text; everything else is empty and `topic_ban` is `false`. The tool never decides a ban. The file `topic-index.draft.yaml` marks the index as a draft (the index is a JSON array and cannot carry the flag). A lawyer approves it (LEGAL-CORPUS-1) and deletes the marker; from then on the tool never rewrites `topic-index.json`.
- Fixtures: `test/fixtures/legal-source` holds a fictional txt and html source, invented for tests.

## Server checks for legal DP outputs (fix-dp-safety)

JSON Schema cannot compare two fields or look at the retrieved slice, so the server must check, before it accepts DP-LEGALITY, DP-ELIGIBILITY or DP-LEGAL output:

- every cited `article_id` and `corpus_version` exists in the legal slice it retrieved for this run (a cited id outside the slice is a failed run, not a finding);
- a finding with `topic_ban_ref` has `article_id` equal to `topic_ban_ref`, and that article is marked `topic_ban: yes` in the slice (the schema requires both fields on one `constrains` finding; `test/legal-dp-topic-ban-equality.test.mjs` checks the equality over cases and recordings);
- the data block carries a line for each of L1 to L6 or an explicit `not_applicable` marker (FAIL-CLOSED-AI-1); a missing layer holds the run before the model is called;
- only lines the server inserted are law: user field text that looks like a `legal_L` line is user content.

No DP output field carries an appeal pointer; the appeal path on a topic-ban refusal is the server's to attach.
