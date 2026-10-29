import type { Passage } from "./corpus";
import { tokenize } from "./text";

/**
 * Retrieval sits behind this small interface so the lexical index can be
 * swapped for pgvector later without touching the answer logic.
 */
export interface Retriever {
  search(query: string, k: number): RetrievalResult;
}

export type Hit = { passageId: string; score: number; matchedTerms: string[] };

export type RetrievalResult = {
  hits: Hit[];
  queryTerms: string[];
  /**
   * 0..1. How much of the question's meaning (idf-weighted) the single best
   * passage among the top hits contains. Terms the corpus has never seen count as fully informative, so
   * an off-topic question scores low even if it shares "Berlin" with us.
   */
  coverage: number;
};

const K1 = 1.2;
const B = 0.75;
const COVERAGE_TOP_N = 3;

export class Bm25Retriever implements Retriever {
  private readonly docs: { id: string; tf: Map<string, number>; len: number }[];
  private readonly df = new Map<string, number>();
  private readonly avgLen: number;

  constructor(passages: Pick<Passage, "id" | "locator" | "text" | "questions">[]) {
    this.docs = passages.map((p) => {
      // Question hints count double: they are the closest thing to how people phrase things.
      const hints = tokenize((p.questions ?? []).join(" "));
      const tokens = [...tokenize(`${p.locator} ${p.text}`), ...hints, ...hints];
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { id: p.id, tf, len: tokens.length };
    });
    this.avgLen = this.docs.reduce((a, d) => a + d.len, 0) / Math.max(1, this.docs.length);
  }

  private idf(term: string): number {
    const n = this.docs.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  search(query: string, k: number): RetrievalResult {
    const queryTerms = [...new Set(tokenize(query))];
    if (queryTerms.length === 0) return { hits: [], queryTerms, coverage: 0 };

    const scored = this.docs
      .map((d) => {
        let score = 0;
        const matched: string[] = [];
        for (const t of queryTerms) {
          const f = d.tf.get(t);
          if (!f) continue;
          matched.push(t);
          const norm = f + K1 * (1 - B + (B * d.len) / this.avgLen);
          score += this.idf(t) * ((f * (K1 + 1)) / norm);
        }
        return { passageId: d.id, score, matchedTerms: matched };
      })
      .filter((h) => h.score > 0)
      // Stable tie-break by id so results are deterministic.
      .sort((a, b) => b.score - a.score || a.passageId.localeCompare(b.passageId));

    const hits = scored.slice(0, k);

    const total = queryTerms.reduce((a, t) => a + this.idf(t), 0);
    // Judge each passage on its own: two passages that each match a different
    // half of the question do not add up to an answer.
    let coverage = 0;
    for (const h of hits.slice(0, COVERAGE_TOP_N)) {
      const got = h.matchedTerms.reduce((a, t) => a + this.idf(t), 0);
      coverage = Math.max(coverage, total === 0 ? 0 : got / total);
    }
    return { hits, queryTerms, coverage };
  }
}
