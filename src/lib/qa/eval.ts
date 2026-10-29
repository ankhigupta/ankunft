import { type AnswerContext, type RefusalCategory, answerQuestion } from "./answer";

/**
 * A small, honest evaluation of the Q&A. Each case says what SHOULD happen:
 * answer from one of these passages, abstain, or refuse.
 */

export type GoldCase = {
  id: string;
  q: string;
  expect: "answer" | "abstain" | "refuse";
  /** Acceptable passages for an answer. The question counts as answered if any is returned. */
  passages?: string[];
  category?: RefusalCategory;
};

export type CaseResult = {
  case: GoldCase;
  outcome: "answer" | "abstain" | "refuse";
  returned: string[];
  /** For answerable cases: the first returned passage is acceptable. */
  top1: boolean;
  pass: boolean;
};

export type EvalSummary = {
  answerable: { n: number; hitAt3: number; top1: number; abstainedWrongly: number; refusedWrongly: number };
  unanswerable: { n: number; abstained: number; answeredWrongly: number };
  refusal: { n: number; refused: number; rightCategory: number };
  passed: number;
  total: number;
};

export function runEval(cases: GoldCase[], ctx: AnswerContext): { results: CaseResult[]; summary: EvalSummary } {
  const results: CaseResult[] = cases.map((c) => {
    const r = answerQuestion(c.q, ctx);
    const returned = r.kind === "answer" ? r.passages.map((p) => p.citation.passageId) : [];
    const ok = new Set(c.passages ?? []);
    const top1 = returned.length > 0 && ok.has(returned[0]);
    let pass = false;
    if (c.expect === "answer") pass = r.kind === "answer" && returned.some((id) => ok.has(id));
    else if (c.expect === "abstain") pass = r.kind === "abstain";
    else pass = r.kind === "refuse" && (!c.category || r.category === c.category);
    return { case: c, outcome: r.kind, returned, top1, pass };
  });

  const of = (e: GoldCase["expect"]) => results.filter((r) => r.case.expect === e);
  const ans = of("answer");
  const un = of("abstain");
  const ref = of("refuse");
  const summary: EvalSummary = {
    answerable: {
      n: ans.length,
      hitAt3: ans.filter((r) => r.pass).length,
      top1: ans.filter((r) => r.top1).length,
      abstainedWrongly: ans.filter((r) => r.outcome === "abstain").length,
      refusedWrongly: ans.filter((r) => r.outcome === "refuse").length,
    },
    unanswerable: {
      n: un.length,
      abstained: un.filter((r) => r.outcome === "abstain").length,
      answeredWrongly: un.filter((r) => r.outcome === "answer").length,
    },
    refusal: {
      n: ref.length,
      refused: ref.filter((r) => r.outcome === "refuse").length,
      rightCategory: ref.filter((r) => r.pass).length,
    },
    passed: results.filter((r) => r.pass).length,
    total: results.length,
  };
  return { results, summary };
}

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${Math.round((100 * a) / b)}%`);

export function formatReport(results: CaseResult[], s: EvalSummary): string {
  const lines: string[] = [];
  lines.push("Q&A evaluation");
  lines.push(
    `  Answerable questions (${s.answerable.n}): right passage in the answer ${s.answerable.hitAt3}/${s.answerable.n} (${pct(s.answerable.hitAt3, s.answerable.n)}), ` +
      `right passage first ${s.answerable.top1}/${s.answerable.n} (${pct(s.answerable.top1, s.answerable.n)}), ` +
      `wrongly abstained ${s.answerable.abstainedWrongly}, wrongly refused ${s.answerable.refusedWrongly}`,
  );
  lines.push(
    `  Not in the sources (${s.unanswerable.n}): abstained ${s.unanswerable.abstained}/${s.unanswerable.n} (${pct(s.unanswerable.abstained, s.unanswerable.n)}), ` +
      `answered anyway ${s.unanswerable.answeredWrongly}`,
  );
  lines.push(
    `  Judgement questions (${s.refusal.n}): refused with the right category ${s.refusal.rightCategory}/${s.refusal.n} (${pct(s.refusal.rightCategory, s.refusal.n)})`,
  );
  lines.push(`  Overall: ${s.passed}/${s.total} cases as expected`);
  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    lines.push("", "Cases that did not go as expected:");
    for (const f of failed) {
      lines.push(
        `  ${f.case.id} [expected ${f.case.expect}${f.case.passages ? " " + f.case.passages.join("/") : ""}] got ${f.outcome}${f.returned.length ? " " + f.returned.join(",") : ""}: ${f.case.q}`,
      );
    }
  }
  return lines.join("\n");
}
