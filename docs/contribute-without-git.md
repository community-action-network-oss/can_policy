# Contribute without git

This page is for lawyers, activists, rights and policy experts, and anyone else who knows how a rule works in the real world. You need a web browser and a free GitHub account. You do not need git, a terminal or any coding skill. Whatever your expertise, it is welcome, and you do not have to prove it before you suggest something.

Short words used on this page:
- **Repo** (repository): the shared folder that holds all the rules.
- **Pack**: a bundle of rules that the platform loads as one version.
- **Pull request** (PR): a proposed change that others can read, discuss and check before anything is accepted.
- **CI**: the automatic checker that runs on every proposal.
- **Ratification**: the formal approval, by named humans, that lets a version take effect.

## What you can propose

- Wording of a rule.
- A labeled example, or a test case, for a decision point (a place where the platform makes a judgement, such as checking whether a post is on topic).
- A change to a legal text we hold, or a missing article. See `docs/contributing-legal-corpus.md`.
- A review record for a legal text, signed by a named human reviewer.
- A number in `limits.yaml`, for example how many replies one person may make on one problem in a day.
- A simulation idea: a situation the platform should handle better.

Everything is a proposal. Nothing you send changes the live platform by itself.

## What cannot be changed here

A short list of core protections (the "protected core", Constitution I.2) cannot be changed by a normal proposal. They change only through a constitutional amendment under Article VIII.2. Anyone may propose an amendment, but today no extraordinary procedure exists, so those protections are frozen. A pull request that touches them is refused automatically. If your idea needs one of them to change, say so on the issue form (choose "A protected core rule"). A maintainer will explain the amendment route and will not treat it as a failed proposal.

## Which folder holds what

| You want to change | Where it lives |
|---|---|
| Platform rules | `packs/base/rules.yaml` |
| Rules for one city or country | `packs/jurisdictions/<name>/rules.yaml` |
| Examples and test cases for a decision point | `decision-points/<DP-name>/examples/` and `decision-points/<DP-name>/eval/` |
| Numbers such as caps and delays | `limits.yaml` |
| A legal text | `packs/legal/<layer>/<jurisdiction>/<corpus>/` |
| Invented practice situations | `simulation/` |

Do not look for `manifest.json` or `release.json`. They are produced by a tool, and nobody types in them. Never touch `ratifications/`: only the approver writes there.

## Path A: edit a file in the browser

1. Sign in to GitHub and open the can_policy page.
2. Click through the folders to the file you want to change (see the table).
3. Click the pencil icon ("Edit this file"). GitHub may offer to create your own copy of the repo. Accept.
4. Make your change. Keep to the words you would use to explain it to a colleague. Do not paste text produced by an AI tool unless you have read it, understood it and checked it yourself.
5. Click "Commit changes" ("Propose changes"). In the box, write one sentence: what you changed and why.
6. GitHub shows "Create pull request". Click it. A template appears with a short checklist. Fill it in, including the AI-use question. Tick only what is true.
7. Click "Create pull request" again. You are done. You will get an email when someone replies.

If something looks wrong or you are stuck, you can stop at any time. An unfinished proposal does no harm.

## Path B: use an issue form and let a maintainer draft it

If the file editor feels like too much, open the repo's "Issues" tab, click "New issue" and pick a form:

- **Propose a rule**: for rule wording, limits, simulation ideas, and requests that need the protected core.
- **Report a wrong or missing law or article**: for legal texts.
- **Add a labeled example**: for decision-point examples and test cases.

Each form asks the same few things: which layer or place it affects, which jurisdiction, where the source is, why it matters, what should change, and whether an AI tool helped. Answer in plain words. A maintainer turns your issue into a draft change and shows it to you before anything moves on. You stay credited as the person who proposed it.

## Using AI tools

You may use an AI tool to help you write or translate, but you must say so on the form (the tool, and how you used it), and you stay responsible for the content. Do not send private or personal material to a hosted AI service. An AI's output is a draft, never a source. For legal texts, an AI may never write or alter the article text, and a review record needs a named human reviewer: a record that names a tool such as claude, gpt or a bot is refused by the checks.

## What the automatic checks will say

When you open a pull request, CI runs checks. A green tick means the checks passed. A red cross is not a verdict on you. Open "Details" and read the first red line; it names the file and what is wrong, usually a missing field or a character that is not allowed. Reply in the pull request and a maintainer will help you fix it. The checks:

- **verify**: files are complete and well formed, and no forbidden characters appear (our copy uses no em or en dashes). A person still checks that examples are invented.
- **eval**: the decision-point test cases still give the expected answers.
- **replay**: your change is run against saved past cases and the report shows which answers would flip. Flips are fine when you meant them; they just have to be explained.
- **protected-core**: refuses any change to the protected core. The same job runs the legal review check: for legal texts it confirms a review record exists with a named human reviewer and that cited articles exist.

CI never approves anything. It only checks the objective parts.

## What happens after: review and ratification

Ratification means named humans approve one exact version of the pack, with an expiry date and a plan to roll it back if it goes wrong. The record is public.

- **Today**: the founder is the interim steward and approves each version. This is temporary, it is public, and the founder cannot change the protected core.
- **Later**: a randomly chosen community review panel ratifies changes. The method is still an open question (OQ-ratification-method).

Artificial intelligence never ratifies, and never counts as a reviewer or approver. If someone disagrees with a change, their dissent is recorded with it.

## Rules for examples

Every example must be invented or synthetic: no real person, no real incident, no link to live data about a real incident. If an example could be mistaken for a real event, change it first. Real laws appear only as unreviewed stubs until a named human lawyer has reviewed them; never describe one as reviewed unless a review record says so.

## Questions

Open an issue and say what you are trying to do. No question is too basic, and nobody here expects you to know our tools.
