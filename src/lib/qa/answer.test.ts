import { describe, expect, it } from "vitest";
import raw from "../../data/berlin-student.corpus.json";
import { berlinPack } from "../pack/load";
import { type QAResponse, answerQuestion, classifyRefusal } from "./answer";
import { validateCorpus } from "./corpus";
import { berlinCorpus, berlinQA } from "./load";
import { tokenize } from "./text";

const TODAY = "2026-10-24";
const ask = (q: string, todayISO = TODAY): QAResponse => answerQuestion(q, { ...berlinQA, todayISO });
const ids = (r: QAResponse) => (r.kind === "answer" ? r.passages.map((p) => p.citation.passageId) : []);

/* eslint-disable @typescript-eslint/no-explicit-any */
const clone = () => JSON.parse(JSON.stringify(raw)) as any;
const codes = (r: ReturnType<typeof validateCorpus>) => r.issues.map((i) => i.code);

describe("corpus", () => {
  it("validates against the pack", () => {
    expect(validateCorpus(raw, berlinPack).ok).toBe(true);
  });

  it("covers every source in the pack", () => {
    const used = new Set(berlinCorpus.passages.map((p) => p.sourceId));
    for (const s of berlinPack.sources) expect(used.has(s.id), `no passage for ${s.id}`).toBe(true);
  });

  it("is honest about wording: nothing is marked verbatim yet", () => {
    expect(berlinCorpus.passages.every((p) => p.textKind === "paraphrase")).toBe(true);
  });

  it("rejects a passage that cites an unknown source", () => {
    const c = clone();
    c.passages[0].sourceId = "S99";
    expect(codes(validateCorpus(c, berlinPack))).toContain("unknown_source");
  });

  it("rejects a passage that cites an unreliable source", () => {
    const p = JSON.parse(JSON.stringify(berlinPack));
    p.sources.find((s: any) => s.id === "S1").reliability = "unreliable";
    expect(codes(validateCorpus(raw, p))).toContain("unreliable_source");
  });

  it("rejects unknown conflicts and duplicate ids", () => {
    const c = clone();
    c.passages[0].conflictIds = ["C-NOPE"];
    c.passages[1].id = c.passages[0].id;
    const r = codes(validateCorpus(c, berlinPack));
    expect(r).toContain("unknown_conflict");
    expect(r).toContain("duplicate_id");
  });

  it("rejects a corpus built for another pack", () => {
    const c = clone();
    c.packId = "paris-student";
    expect(codes(validateCorpus(c, berlinPack))).toContain("pack_mismatch");
  });
});

describe("tokenizer", () => {
  it("treats German terms and English synonyms alike", () => {
    expect(tokenize("Anmeldung")).toEqual(tokenize("registration"));
    expect(tokenize("Wohnungsgeberbestätigung")).toEqual(tokenize("landlord confirmation"));
  });
  it("keeps numbers and drops filler", () => {
    expect(tokenize("How much is 992 EUR?")).toContain("992");
    expect(tokenize("How do I")).toEqual([]);
  });
});

describe("answers with citations", () => {
  const cases: [string, string][] = [
    ["How many days do I have to register my address after moving in?", "P001"],
    ["Does a rental contract replace the landlord's confirmation?", "P009"],
    ["What documents do I need for Anmeldung?", "P009"],
    ["Is Anmeldung free?", "P011"],
    ["How much money do I need to show for the study residence permit?", "P050"],
    ["Is my foreign health insurance accepted?", "P013"],
    ["Can I use a lease as proof of residence for the permit?", "P014"],
    ["How much does the residence permit cost?", "P019"],
    ["Can I walk in to the immigration office without an appointment?", "P026"],
    ["How do I get my tax ID?", "P039"],
    ["Do I have to register for the broadcasting fee?", "P041"],
    ["How does a blocked account work?", "P045"],
  ];

  it.each(cases)("%s -> %s", (q, expected) => {
    const r = ask(q);
    expect(r.kind).toBe("answer");
    expect(ids(r)).toContain(expected);
  });

  it("puts a deadline passage first when asked about the registration deadline", () => {
    for (const q of [
      "How many days do I have to register my address?",
      "When is the deadline for Anmeldung?",
      "How long do I have to register after moving in?",
    ]) {
      const r = ask(q);
      expect(r.kind).toBe("answer");
      expect(["P001", "P008", "P031", "P002"]).toContain(ids(r)[0]);
      expect(ids(r).some((id) => id === "P001" || id === "P008")).toBe(true);
    }
  });

  it("every returned passage carries a full citation", () => {
    for (const [q] of cases) {
      const r = ask(q);
      if (r.kind !== "answer") continue;
      for (const p of r.passages) {
        const c = p.citation;
        expect(c.url).toMatch(/^https:\/\//);
        expect(c.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(c.textKind).toBe("paraphrase");
        expect(berlinPack.sources.some((s) => s.id === c.sourceId)).toBe(true);
      }
    }
  });

  it("is deterministic", () => {
    const q = "How many days do I have to register my address after moving in?";
    expect(JSON.stringify(ask(q))).toBe(JSON.stringify(ask(q)));
  });

  it("always labels paraphrases as paraphrases", () => {
    const r = ask("Is Anmeldung free?");
    expect(r.kind === "answer" && r.notices.join(" ")).toMatch(/paraphrase/);
  });
});

describe("surfaces conflicts instead of hiding them", () => {
  it("shows the earliest-application disagreement", () => {
    const r = ask("How early can I apply for the residence permit before it expires?");
    expect(r.kind).toBe("answer");
    if (r.kind === "answer") expect(r.conflicts.map((c) => c.id)).toContain("C-EARLIEST");
  });

  it("shows the foreign-insurance disagreement", () => {
    const r = ask("Is my foreign health insurance accepted?");
    expect(r.kind).toBe("answer");
    if (r.kind === "answer") expect(r.conflicts.map((c) => c.id)).toContain("C-FOREIGN-INSURANCE");
  });
});

describe("abstains instead of guessing", () => {
  it.each([
    "What is the weather in Berlin?",
    "Where can I find cheap student housing?",
    "How do I get a driving licence?",
    "Which bank has the best exchange rate?",
    "What is the capital of France?",
    "asdf qwerty",
    "",
    // Only generic words: no topic to look up, even though passages contain "start" or "first".
    "where to start",
    "where do I start",
    "how do I begin",
    "getting started",
    "what should I do first",
    "what now",
  ])("%j", (q) => {
    expect(ask(q).kind).toBe("abstain");
  });

  it("still answers when a generic word comes with a topic", () => {
    expect(ids(ask("From when does the broadcasting fee start?"))).toContain("P043");
    expect(ids(ask("When does the 14-day registration period begin?"))).toContain("P008");
  });

  it("never returns an uncited passage", () => {
    const r = ask("Can I bring my dog to Germany?");
    if (r.kind === "answer") {
      expect(r.passages.every((p) => p.citation.url)).toBe(true);
    } else {
      expect(r.kind).toBe("abstain");
    }
  });
});

describe("refuses legal and eligibility judgements", () => {
  it.each([
    ["Am I eligible for a residence permit?", "eligibility"],
    ["Do I qualify for a Fiktionsbescheinigung?", "eligibility"],
    ["What are my chances of getting the permit?", "eligibility"],
    ["Will my application be approved?", "prediction"],
    ["Will my residence permit get rejected?", "prediction"],
    ["Can I be deported if I register late?", "legal_outcome"],
    ["Will I be fined for missing the Anmeldung deadline?", "legal_outcome"],
    ["Is it legal to work on a student visa?", "legal_outcome"],
    ["Can you guarantee the permit comes in time?", "prediction"],
  ])("%s", (q, category) => {
    const r = ask(q);
    expect(r.kind).toBe("refuse");
    if (r.kind === "refuse") {
      expect(r.category).toBe(category);
      expect(r.pointers.length).toBeGreaterThan(0);
      expect(r.pointers.every((p) => p.url.startsWith("https://"))).toBe(true);
    }
  });

  it("does not refuse plain rule lookups", () => {
    expect(classifyRefusal("Who is eligible for a Fiktionsbescheinigung?")).toBeNull();
    expect(classifyRefusal("What are the requirements for the study permit?")).toBeNull();
    expect(classifyRefusal("How many days do I have to register?")).toBeNull();
  });
});

describe("source age warnings", () => {
  it("warns when a cited page carries an old date", () => {
    const r = ask("Does the university need a health insurance certificate to enrol?");
    expect(r.kind).toBe("answer");
    if (r.kind === "answer" && r.passages.some((p) => p.citation.pageDate)) {
      expect(r.notices.join(" ")).toMatch(/out of date/);
    }
  });

  it("warns when our sources are stale", () => {
    const r = ask("Is Anmeldung free?", "2027-03-01");
    expect(r.kind === "answer" && r.notices.join(" ")).toMatch(/last checked/);
  });
});
