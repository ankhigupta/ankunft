import type { Pack, Source } from "../pack/schema";
import { isPackStale } from "../pack/validate";
import { diffDays } from "../planner/dates";
import type { Corpus, Passage } from "./corpus";
import type { Retriever } from "./retriever";
import { fold, hasOnlyGenericTerms } from "./text";

/**
 * Answers are EXTRACTIVE: we show the saved passages that match, with their
 * sources. We never generate new factual claims. If the evidence is thin we
 * abstain; if the question asks for a legal judgement we refuse.
 */

export const MIN_COVERAGE = 0.55;
export const MAX_PASSAGES = 3;
/** A secondary passage must score at least this share of the best one. */
export const RELATIVE_CUTOFF = 0.7;
/** Source pages whose own date is older than this get a warning. */
export const OLD_PAGE_YEARS = 3;

export type Citation = {
  passageId: string;
  sourceId: string;
  title: string;
  publisher: string;
  url: string;
  retrievedOn: string;
  pageDate: string | null;
  locator: string;
  textKind: Passage["textKind"];
  authorityType: Source["authorityType"];
};

export type AnswerPassage = { text: string; score: number; citation: Citation };

export type ConflictNotice = { id: string; topic: string; display: string; sourceIds: string[] };

export type RefusalCategory = "eligibility" | "legal_outcome" | "prediction";

export type QAResponse =
  | {
      kind: "answer";
      question: string;
      passages: AnswerPassage[];
      conflicts: ConflictNotice[];
      notices: string[];
    }
  | { kind: "abstain"; question: string; reason: string }
  | {
      kind: "refuse";
      question: string;
      category: RefusalCategory;
      reason: string;
      /** Official places that can actually decide. */
      pointers: { sourceId: string; title: string; url: string }[];
    };

/**
 * Questions that ask us to judge a person's case rather than report a rule.
 * Matched on accent-folded, lowercased text. Kept narrow on purpose: a factual
 * question like "who is eligible for a Fiktionsbescheinigung" is a rule
 * lookup and should be answered from sources.
 */
const REFUSAL_RULES: { category: RefusalCategory; pattern: RegExp }[] = [
  {
    category: "eligibility",
    pattern:
      /\b(am i|are we|would i be|do i|does my [a-z ]{1,30}|could i|can i)\s+(be\s+|still\s+)?(eligible|qualify|qualified|entitled|allowed to (work|stay|travel|study|leave|enter)|permitted)\b/,
  },
  {
    category: "eligibility",
    pattern: /\b(chances?|odds|likelihood|likely to be (approved|rejected|denied))\b/,
  },
  {
    category: "prediction",
    pattern:
      /\bwill (i|my [a-z ]{1,30}|the [a-z ]{1,30})\s+(get|be|been)?\s*(approved|accepted|rejected|denied|granted|refused|declined|extended|issued)\b/,
  },
  {
    // "Will LEA approve my application?"
    category: "prediction",
    pattern: /\bwill\b[^?.]{0,40}\b(approve|accept|reject|deny|grant|refuse|decline|extend)\b/,
  },
  {
    category: "prediction",
    pattern: /\b(guarantee|guaranteed|promise|for sure|definitely get)\b/,
  },
  {
    category: "legal_outcome",
    pattern:
      /\b(deport|deported|deportation|fined|penalt(y|ies)|punish|punished|prosecut\w*|arrested|illegal|unlawful|lawsuit|sue|appeal|widerspruch|klage|lawyer)\b/,
  },
  {
    category: "legal_outcome",
    pattern: /\bis it (legal|allowed|ok|okay|a crime)\b/,
  },
];

/**
 * Other German cities. Ankunft only knows Berlin, and the same words ("register",
 * "residence permit") would match Berlin passages, so we say so instead of answering.
 */
const OTHER_PLACES =
  /\b(munich|munchen|hamburg|frankfurt|cologne|koln|stuttgart|dusseldorf|leipzig|dresden|heidelberg|bonn|aachen|karlsruhe|hannover|hanover|nuremberg|nurnberg|freiburg|bremen|potsdam|mannheim|mainz|jena|gottingen|kiel)\b/;

export function mentionsOtherCity(question: string): boolean {
  const q = fold(question);
  return OTHER_PLACES.test(q) && !/\bberlin\b/.test(q);
}

export function classifyRefusal(question: string): RefusalCategory | null {
  const q = fold(question);
  for (const r of REFUSAL_RULES) if (r.pattern.test(q)) return r.category;
  return null;
}

function cite(p: Passage, src: Source): Citation {
  return {
    passageId: p.id,
    sourceId: src.id,
    title: src.title,
    publisher: src.publisher,
    url: src.url,
    retrievedOn: src.retrievedOn,
    pageDate: src.pageDate,
    locator: p.locator,
    textKind: p.textKind,
    authorityType: src.authorityType,
  };
}

/** Sources a person should go to for a decision about their own case. */
const DECISION_SOURCES = ["S4", "S6"];

export type AnswerContext = {
  pack: Pack;
  corpus: Corpus;
  retriever: Retriever;
  todayISO: string;
};

export function answerQuestion(question: string, ctx: AnswerContext): QAResponse {
  const q = question.trim();
  const { pack, corpus, retriever, todayISO } = ctx;

  const category = classifyRefusal(q);
  if (category) {
    const pointers = DECISION_SOURCES.flatMap((id) => {
      const s = pack.sources.find((x) => x.id === id);
      return s ? [{ sourceId: s.id, title: s.title, url: s.url }] : [];
    });
    return {
      kind: "refuse",
      question: q,
      category,
      reason:
        "This asks for a judgement about your own case, a legal outcome or a prediction. " +
        "That depends on your documents and on the authority's decision, and Ankunft does not give legal advice. " +
        "You can ask what the sources say about a requirement, for example \"what documents does the study residence permit need?\". " +
        "For a decision about your case, contact the immigration office (LEA) or a recognised advice service or lawyer.",
      pointers,
    };
  }

  if (mentionsOtherCity(q)) {
    return {
      kind: "abstain",
      question: q,
      reason:
        "Ankunft only covers Berlin so far, and rules differ between cities and registration offices. " +
        "Ask the local registration office or your university's international office.",
    };
  }

  const result = retriever.search(q, MAX_PASSAGES + 2);
  const top = result.hits[0];
  if (!top || result.coverage < MIN_COVERAGE || hasOnlyGenericTerms(result.queryTerms)) {
    return {
      kind: "abstain",
      question: q,
      reason:
        "I could not find this in the official pages I have saved, so I will not guess. " +
        "Try asking about registering your address, the landlord's confirmation, health insurance, " +
        "proof of funds, or the study residence permit.",
    };
  }

  const byId = new Map(corpus.passages.map((p) => [p.id, p]));
  const srcById = new Map(pack.sources.map((s) => [s.id, s]));

  const chosen = result.hits
    .filter((h, i) => i === 0 || h.score >= top.score * RELATIVE_CUTOFF)
    .slice(0, MAX_PASSAGES);

  const passages: AnswerPassage[] = [];
  for (const h of chosen) {
    const p = byId.get(h.passageId);
    const s = p ? srcById.get(p.sourceId) : undefined;
    if (!p || !s) continue; // cannot happen for a validated corpus; never show an uncited passage
    passages.push({ text: p.text, score: Number(h.score.toFixed(3)), citation: cite(p, s) });
  }
  if (passages.length === 0) {
    return { kind: "abstain", question: q, reason: "No citable passage matched." };
  }

  const conflictIds = new Set(
    chosen.flatMap((h) => byId.get(h.passageId)?.conflictIds ?? []),
  );
  const conflicts: ConflictNotice[] = pack.conflicts
    .filter((c) => conflictIds.has(c.id))
    .map((c) => ({
      id: c.id,
      topic: c.topic,
      display: c.display,
      sourceIds: [...new Set(c.statements.flatMap((s) => s.sourceIds))],
    }));

  const notices: string[] = [];
  if (passages.some((p) => p.citation.textKind === "paraphrase")) {
    notices.push(
      "These passages are our paraphrase of the source pages as retrieved on the dates shown, not exact quotes. Open the source before acting.",
    );
  }
  for (const p of passages) {
    if (p.citation.pageDate && diffDays(todayISO, p.citation.pageDate) > OLD_PAGE_YEARS * 365) {
      notices.push(
        `${p.citation.title}: the page's own date is ${p.citation.pageDate}, so parts may be out of date.`,
      );
    }
  }
  if (isPackStale(pack, todayISO)) {
    notices.push(
      `Our sources were last checked on ${pack.verifiedOn}, which is more than ${pack.staleAfterDays} days ago. Re-check the linked pages.`,
    );
  }

  return { kind: "answer", question: q, passages, conflicts, notices: [...new Set(notices)] };
}
