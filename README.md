# Ankunft

An arrival copilot for non-EU students coming to Berlin. It works out what to do next, in what order, and by when, and shows the official source behind every rule.

## What it does

- **Planner.** A deterministic engine, with no language model, turns your situation (entry route, arrival date, move-in date, visa end date) into task states: done, overdue, due soon, waiting, ready, info. Only deadlines stated by law or by the authority can make a task overdue.
- **Law versus inference.** Every dependency is labelled: required by law, required by the authority, order suggested by a source, or our inference. Sources that disagree are shown side by side, never silently resolved.
- **Cited Q&A.** Answers are extracted from saved official passages and carry the source, locator and retrieval date. Where evidence is thin it abstains, and it refuses questions that ask it to judge eligibility or legal outcomes.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # planner, data-pack validator and Q&A tests
npm run typecheck
npm run build
```

## Layout

| Path | What lives there |
| --- | --- |
| `src/data/berlin-student.pack.json` | The Berlin data pack: tasks, requirements, deadline rules, sources, conflicts |
| `src/data/berlin-student.corpus.json` | Passages for Q&A, each tied to a source in the pack |
| `src/lib/pack` | Pack schema and the validator that enforces the trust rules |
| `src/lib/planner` | The generic planning engine (no Berlin rules inside) |
| `src/lib/qa` | Tokeniser, BM25 retriever behind a `Retriever` interface, answer/abstain/refuse logic |
| `src/app/api/ask` | `POST /api/ask` |

## Trust rules the validator enforces

- A statutory deadline must cite a statute itself. A mirror of one does not count.
- A rule labelled "law" must cite a statute.
- An inferred dependency must explain itself.
- A rule cannot rest on a source marked unreliable.
- Deadlines with no official source are stored as "none found" and never computed.

## Q&A evaluation

`npm run eval` runs 74 questions through the Q&A and reports how often the right passage is returned, how often it correctly abstains, and how often it correctly refuses. The same checks run in `npm test`.

| Measure | First run, before tuning | After tuning (main set) | Second set, run once after tuning |
| --- | --- | --- | --- |
| Right passage in the answer | 25 of 39 (64%) | 35 of 38 (92%) | 8 of 12 (67%) |
| Right passage ranked first | 20 of 39 (51%) | 28 of 38 (74%) | 7 of 12 (58%) |
| Questions not in the sources: abstained | 9 of 9 | 10 of 10 | 5 of 5 |
| Judgement questions: refused correctly | 4 of 6 | 6 of 6 | 3 of 3 |

What this says, honestly:
- The safety behaviour holds: no question outside the sources was answered, and every judgement question was refused.
- Finding the right passage is weaker on wording the system has not seen: about two thirds, against 92% on the questions used while tuning. Lexical search with a hand-built vocabulary reaches a ceiling here.
- Both sets were written by the builder, so this is not a blind test. One case (g07, a sublet question) was re-labelled after the first run, because the pack lists sublet cases as unverified, so abstaining is correct.
- Known misses on the main set: g02 (a lease question about Anmeldung returns permit passages), g05 (a fee question about registering a flat returns the broadcasting contribution), g06 (what document you receive after Anmeldung).

## Known limits

- Berlin and students on a national study visa only. Other cases show "not covered yet".
- The Q&A passages are paraphrases of the pages as retrieved on 23 Oct 2026, labelled as such. Replace each with the page's exact wording and set `textKind` to `verbatim`.
- Unverified items (for example §41 AufenthV, §81 AufenthG, TU Berlin enrolment rules) are listed as open questions in the pack.
- Not legal advice.
