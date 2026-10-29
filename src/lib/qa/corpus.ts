import { z } from "zod";
import type { Pack } from "../pack/schema";

/**
 * The Q&A corpus: short passages, each tied to exactly one pack source.
 * The source (URL, publisher, retrieval date, reliability) lives in the pack,
 * so a passage can never cite something the planner does not also know about.
 */

export const PassageSchema = z.strictObject({
  id: z.string().regex(/^P\d{3,}$/),
  sourceId: z.string(),
  /** Where on the source page / in the statute this comes from. */
  locator: z.string().min(1),
  /** Example questions this passage answers. Search hints only; never shown as an answer. */
  questions: z.array(z.string().min(5)).optional(),
  /**
   * paraphrase: our wording of what the page said when we retrieved it.
   * verbatim: exact text copied from the page.
   * The UI must say which one it is showing.
   */
  textKind: z.enum(["paraphrase", "verbatim"]),
  text: z.string().min(20),
  /** Pack conflicts this passage is part of; the answer will surface them. */
  conflictIds: z.array(z.string()).optional(),
});
export type Passage = z.infer<typeof PassageSchema>;

export const CorpusSchema = z.strictObject({
  packId: z.string(),
  note: z.string(),
  passages: z.array(PassageSchema).min(1),
});
export type Corpus = z.infer<typeof CorpusSchema>;

export type CorpusIssue = { code: string; path: string; message: string };

export function validateCorpus(
  raw: unknown,
  pack: Pack,
): { ok: boolean; corpus?: Corpus; issues: CorpusIssue[] } {
  const parsed = CorpusSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        code: "schema",
        path: i.path.join("."),
        message: i.message,
      })),
    };
  }
  const corpus = parsed.data;
  const issues: CorpusIssue[] = [];
  const sources = new Map(pack.sources.map((s) => [s.id, s]));
  const conflicts = new Set(pack.conflicts.map((c) => c.id));
  const seen = new Set<string>();

  if (corpus.packId !== pack.id) {
    issues.push({
      code: "pack_mismatch",
      path: "packId",
      message: `corpus is for "${corpus.packId}" but the pack is "${pack.id}"`,
    });
  }

  corpus.passages.forEach((p, i) => {
    const at = `passages.${i}`;
    if (seen.has(p.id)) {
      issues.push({ code: "duplicate_id", path: at, message: `duplicate passage id ${p.id}` });
    }
    seen.add(p.id);

    const src = sources.get(p.sourceId);
    if (!src) {
      issues.push({ code: "unknown_source", path: at, message: `${p.id} cites unknown source ${p.sourceId}` });
    } else if (src.reliability === "unreliable") {
      issues.push({ code: "unreliable_source", path: at, message: `${p.id} cites unreliable source ${p.sourceId}` });
    }
    for (const cid of p.conflictIds ?? []) {
      if (!conflicts.has(cid)) {
        issues.push({ code: "unknown_conflict", path: at, message: `${p.id} references unknown conflict ${cid}` });
      }
    }
  });

  const errors = issues.length;
  return { ok: errors === 0, corpus: errors === 0 ? corpus : undefined, issues };
}
