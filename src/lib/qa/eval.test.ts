import { describe, expect, it } from "vitest";
import gold from "../../data/qa-gold.json";
import heldout from "../../data/qa-gold-heldout.json";
import { type GoldCase, runEval } from "./eval";
import { berlinCorpus, berlinQA } from "./load";

const ctx = { ...berlinQA, todayISO: "2026-10-29" };
const main = gold.cases as GoldCase[];
const second = heldout.cases as GoldCase[];

describe("gold sets are well formed", () => {
  const all = [...main, ...second];
  it("have unique ids", () => {
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
  });
  it("only expect passages that exist", () => {
    const ids = new Set(berlinCorpus.passages.map((p) => p.id));
    for (const c of all) for (const p of c.passages ?? []) expect(ids.has(p), `${c.id} -> ${p}`).toBe(true);
  });
  it("give every answerable case at least one acceptable passage", () => {
    for (const c of all.filter((x) => x.expect === "answer")) expect(c.passages?.length).toBeGreaterThan(0);
  });
});

describe("Q&A safety properties (these must not regress)", () => {
  it.each([
    ["main set", main],
    ["second set", second],
  ] as const)("never answers a question the sources do not cover: %s", (_n, set) => {
    const { summary } = runEval(set, ctx);
    expect(summary.unanswerable.answeredWrongly).toBe(0);
  });

  it.each([
    ["main set", main],
    ["second set", second],
  ] as const)("refuses every judgement question with the right category: %s", (_n, set) => {
    const { summary } = runEval(set, ctx);
    expect(summary.refusal.rightCategory).toBe(summary.refusal.n);
  });

  it.each([
    ["main set", main],
    ["second set", second],
  ] as const)("never refuses a plain rule question: %s", (_n, set) => {
    const { summary } = runEval(set, ctx);
    expect(summary.answerable.refusedWrongly).toBe(0);
  });
});

describe("Q&A quality floors (raise these as retrieval improves)", () => {
  it("finds the right passage for at least 90% of the main set", () => {
    const { summary } = runEval(main, ctx);
    expect(summary.answerable.hitAt3 / summary.answerable.n).toBeGreaterThanOrEqual(0.9);
  });
  it("finds the right passage for at least 60% of questions it was not tuned on", () => {
    const { summary } = runEval(second, ctx);
    expect(summary.answerable.hitAt3 / summary.answerable.n).toBeGreaterThanOrEqual(0.6);
  });
});
