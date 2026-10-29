import raw from "../../data/berlin-student.corpus.json";
import { berlinPack } from "../pack/load";
import type { AnswerContext } from "./answer";
import { type Corpus, validateCorpus } from "./corpus";
import { Bm25Retriever } from "./retriever";

function load(): Corpus {
  const r = validateCorpus(raw, berlinPack);
  if (!r.ok || !r.corpus) {
    throw new Error(
      `Berlin corpus failed validation:\n${r.issues.map((i) => `  [${i.code}] ${i.path}: ${i.message}`).join("\n")}`,
    );
  }
  return r.corpus;
}

export const berlinCorpus: Corpus = load();

const retriever = new Bm25Retriever(berlinCorpus.passages);

/** Everything the Q&A needs, minus today's date (callers supply it). */
export const berlinQA: Omit<AnswerContext, "todayISO"> = {
  pack: berlinPack,
  corpus: berlinCorpus,
  retriever,
};
