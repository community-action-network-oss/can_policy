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
