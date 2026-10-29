"use client";

import { useEffect, useRef, useState } from "react";
import { fmtDate } from "@/lib/format";
import type { QAResponse } from "@/lib/qa/answer";
import { askQuestion } from "@/lib/qa/client";

const EXAMPLES = [
  "How many days do I have to register my address?",
  "Does my lease replace the landlord's confirmation?",
  "Is my foreign health insurance accepted?",
  "How much money do I need to show for the permit?",
];

export function Ask({ today }: { today: string }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<QAResponse | null>(null);

  const latest = useRef(0);
  const resultRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The typed question stays in the input after submitting, so it can be edited and re-asked.
  async function submit(text: string) {
    const question = text.trim();
    if (!question) return;
    const id = ++latest.current;
    setBusy(true);
    setAsked(question);
    setError(null);
    setRes(null);
    try {
      const data = await askQuestion(question, today);
      if (id === latest.current) setRes(data);
    } catch (e) {
      if (id === latest.current) setError(e instanceof Error ? e.message : "The question could not be sent.");
    } finally {
      if (id === latest.current) setBusy(false);
    }
  }

  // Results render below the examples; bring them into view so a submit never looks like a no-op.
  useEffect(() => {
    if (res || error) resultRef.current?.scrollIntoView({ block: "nearest" });
  }, [res, error]);

  return (
    <section className="ask" aria-labelledby="ask-title">
      <h2 id="ask-title" className="ask__title">
        Ask about a rule
      </h2>
      <p className="ask__intro">
        Answers come only from the official pages we saved. If they do not cover your question, we say so.
        We cannot judge whether you qualify for anything.
      </p>
      <form
        className="ask__form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(q);
        }}
      >
        <label htmlFor="ask-q" className="sr-only">
          Your question
        </label>
        <input
          id="ask-q"
          ref={inputRef}
          type="text"
          value={q}
          maxLength={500}
          placeholder="For example: how long do I have to register?"
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="btn btn--ink" disabled={busy || q.trim().length === 0}>
          {busy ? "Searching" : "Ask"}
        </button>
      </form>
      <ul className="ask__examples">
        {EXAMPLES.map((ex) => (
          <li key={ex}>
            <button
              type="button"
              className="linkish"
              onClick={() => {
                // Fill only: the person reviews or edits the question, then asks.
                setQ(ex);
                inputRef.current?.focus();
              }}
            >
              {ex}
            </button>
          </li>
        ))}
      </ul>

      <div className="ask__result" aria-live="polite" ref={resultRef}>
        {busy && <p className="note">Searching the saved pages for: {asked}</p>}
        {error && <p className="note note--warn">{error}</p>}
        {res?.kind === "answer" && (
          <>
            {res.passages.map((p) => (
              <article key={p.citation.passageId} className="quote">
                <p>{p.text}</p>
                <p className="quote__cite">
                  {p.citation.textKind === "paraphrase" ? "Our paraphrase of " : "Quoted from "}
                  <a href={p.citation.url} target="_blank" rel="noreferrer">
                    {p.citation.title}
                  </a>
                  , {p.citation.locator}. {p.citation.publisher}, retrieved {fmtDate(p.citation.retrievedOn)}.
                </p>
              </article>
            ))}
            {res.conflicts.map((c) => (
              <div key={c.id} className="note note--conflict">
                <h4>Sources disagree: {c.topic}</h4>
                <p>{c.display}</p>
              </div>
            ))}
            {res.notices.map((n) => (
              <p key={n} className="note">
                {n}
              </p>
            ))}
          </>
        )}
        {res?.kind === "abstain" && <p className="note note--abstain">{res.reason}</p>}
        {res?.kind === "refuse" && (
          <div className="note note--refuse">
            <p>{res.reason}</p>
            <ul className="plain">
              {res.pointers.map((p) => (
                <li key={p.sourceId}>
                  <a href={p.url} target="_blank" rel="noreferrer">
                    {p.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
