# Contributing to the legal corpus, the archive eval and the practice jurisdictions

For lawyers, activists and policy experts. You do not need git; read `docs/contribute-without-git.md` first for the basic steps. The technical format of a legal corpus is in `docs/legal-corpora.md`.

Status today: every real legal corpus here is an unreviewed stub. The only complete corpora are invented ones for the made-up world of Fiktiva. Nothing on this page lets anyone present a real law as reviewed unless a named human reviewer has signed a review record for it.

## Rules that never bend

- The article text is the official text, word for word. It is never rewritten, summarised or tidied by a person or an AI. If the official text has a typo, the typo stays and you note it.
- The authority is the official text in its authoritative language. A translation may be added as a translation, never as the cited text.
- An AI may help you find a source or write your explanation. It may not write or change article text, and it may not review a corpus. A review record names a real, qualified human. Names such as claude, gpt, llm or bot are refused by the checks.
- This is not legal advice to anyone. Nothing here tells a person what to do in their own case.
- Use public material only. No real people, no private documents, no personal data.

## What a change to a legal text needs

Every one of these goes on the issue form "Report a wrong or missing law or article", or in the pull request, in plain words:

1. **Official source**: the link to the official text and who publishes it (the official publisher).
2. **Retrieval date**: the day you downloaded or read it.
3. **Version and effective date**: which version of the text, the date it came into force, and the date it stopped being in force if it did.
4. **Language**: the authoritative language of the text.
5. **Article text**: the exact words, copied from the official file.
6. **Topic index entries**: for each article, a short list of the subjects it touches, who it applies to and what it limits. A rough list is fine; a lawyer checks it. Only a reviewed corpus can mark a topic as banned.
7. **A review record**: the name of the human reviewer, their qualification for this jurisdiction, the date, and which articles or layers they covered. If you are not able to review it yourself, say so and ask for a reviewer. That is a normal request, and your correction still counts.
8. **The licence** of the source text.

A change without a version increase and a review record is not accepted as reviewed (rule LEGAL-CORPUS-1). It can still be kept as a draft.

The layers, from broadest to narrowest: L1 UN, L2 supranational (for example a regional union or court), L3 constitution, L4 national law, L5 regional law, L6 city. Folders: `packs/legal/<layer>/<jurisdiction>/<corpus>/`.

## What a review record says

A lawyer or other qualified person states: "I compared these articles with the official source at this version and they match." It lists their qualification, the scope (which articles or layers) and the date. It is not an opinion on what the law means. Who may act as a reviewer is still an open question (OQ-legal-policy-reviewers); until it is answered, a maintainer will ask you for the facts above and decide with you.

## When two layers disagree

If a national rule seems to conflict with a human rights text, do not choose a winner yourself. Report it. Describe both articles, both layers and why they seem to conflict. The platform holds the case with a conflict note, shows the person a plain explanation and an appeal, and queues the question for the community (OQ-legal-layer-conflicts). The human rights core protections stay in force meanwhile.

## What happens after a legal change is accepted

A new version of a corpus triggers re-moderation and re-resolution: posts and problems that relied on the old text are checked again. As a contributor or reviewer you may see notices about this. They are expected, and they are not a sign that you did something wrong. Before approval, the proposal reports an estimate of how many items are affected.

## Contributing to the archive retrieval and fit eval

The platform keeps an archive of finished problems and can suggest a similar earlier path. We test two things offline (docs/design/ai/archive-reuse.md, section 10): does the search find the right earlier records, and does the fit check catch steps that would be illegal at some layer.

You can contribute:
- **Synthetic archive records**: invented finished problems, written like real ones.
- **Query problems**: new problems, with the records that should be found, including the same problem paraphrased or in another language.
- **Look-alike records** that should not be found, to test near misses.
- **Planted legality faults**: a step in a path that is illegal at one named layer, so we can test that it is flagged. State the layer and the article.

These belong under `evals/archive` in this repo (see `docs/eval-archive.md` for the layout and how to add a record or query). The set is synthetic only: no real people or real incidents. If you do not use git, use the "Add a labeled example" form and say "archive eval"; a maintainer will place your item.

A good record:
- is entirely invented, with an invented place (Fiktiva or a made-up town), invented organisations and invented names that cannot be mistaken for real people;
- has a clear problem, constraints, a path of stages, an outcome (solved, stuck or blocked), and honest notes on what failed;
- states which legal layers apply and what each one allows;
- includes one thing a careful reader might get wrong, so the test is useful;
- never links to live data about a real incident.

## Contributing to the practice jurisdictions

The folders `packs/jurisdictions/fiktiva-city`, `fiktiva-north` and the Amsterdam overlay are practice settings that test how the platform behaves when two places have different rules. Nothing in the invented ones is real law.

To write down how legality differs between two jurisdictions:
1. Name both places and the activity (for example "gathering outside a public building").
2. For each layer, say whether the activity is allowed, allowed with conditions, or forbidden, and cite the invented article that says so.
3. Say what the difference changes in practice: a step becomes illegal, needs a permit, or needs a different route.
4. If a layer is missing in one place, say so explicitly. Do not leave it blank: a blank is a different thing from "does not apply".

Send it on the "Add a labeled example" form, naming the two places.

## What we will not accept

- Real people, private evidence or personal data in any example.
- A real law described as reviewed without a review record from a named human.
- Article text that was paraphrased, summarised or machine-translated and passed off as official.
- A review signed by a tool.
