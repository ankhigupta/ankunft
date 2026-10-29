"use client";

import { BASIS_LABEL, DEADLINE_KIND_LABEL, STATE_LABEL, daysPhrase, fmtDate, prettyDates } from "@/lib/format";
import type { Pack, Profile } from "@/lib/pack/schema";
import type { Plan, TaskPlan } from "@/lib/planner/engine";
import { SourceList } from "./Sources";

type Props = {
  pack: Pack;
  plan: Plan;
  profile: Profile;
  openId: string | null;
  onToggle: (id: string) => void;
  onSetDone: (id: string, done: boolean) => void;
};

function dueText(t: TaskPlan): string {
  const d = t.deadline;
  if (t.mode === "info_only" || t.done) return "";
  if (d.status === "computed" && d.date) return fmtDate(d.date);
  if (d.status === "needs_input") return "Needs your dates";
  if (d.status === "informational") return "No fixed date";
  return "No official date";
}

export function Board({ pack, plan, profile, openId, onToggle, onSetDone }: Props) {
  const tracked = plan.tasks.filter((t) => t.mode === "tracked");
  const info = plan.tasks.filter((t) => t.mode === "info_only");

  return (
    <section className="board" aria-labelledby="board-title">
      <h2 id="board-title" className="board__title">
        All steps
      </h2>
      <div className="board__head" aria-hidden="true">
        <span>Step</span>
        <span>Status</span>
        <span>Due</span>
      </div>
      <ol className="board__rows">
        {tracked.map((t) => (
          <Row key={t.id} {...{ pack, plan, profile, t, openId, onToggle, onSetDone }} />
        ))}
      </ol>
      {info.length > 0 && (
        <>
          <h3 className="board__sub">Good to know</h3>
          <ol className="board__rows">
            {info.map((t) => (
              <Row key={t.id} {...{ pack, plan, profile, t, openId, onToggle, onSetDone }} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function Row({
  pack,
  plan,
  profile,
  t,
  openId,
  onToggle,
  onSetDone,
}: Props & { t: TaskPlan }) {
  const open = openId === t.id;
  const panelId = `panel-${t.id}`;
  return (
    <li id={`row-${t.id}`} className={`row row--${t.state}${open ? " row--open" : ""}`}>
      <h3 className="row__h">
        <button
          type="button"
          className="row__btn"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onToggle(t.id)}
        >
          <span className="row__title">{t.title}</span>
          <span className={`chip chip--${t.state}`}>{STATE_LABEL[t.state]}</span>
          <span className="row__due">
            {dueText(t)}
            {t.mode === "tracked" && !t.done && t.deadline.status === "computed" && !t.deadline.hard && (
              <small className="row__basis">Guidance, not a legal date</small>
            )}
          </span>
        </button>
      </h3>
      {open && (
        <div id={panelId} className="detail">
          <Detail {...{ pack, plan, profile, t, onSetDone }} />
        </div>
      )}
    </li>
  );
}

function Detail({
  pack,
  plan,
  profile,
  t,
  onSetDone,
}: {
  pack: Pack;
  plan: Plan;
  profile: Profile;
  t: TaskPlan;
  onSetDone: (id: string, done: boolean) => void;
}) {
  const title = (id: string) => plan.tasks.find((x) => x.id === id)?.title ?? id;
  const inputLabel = (id: string) => pack.inputs.find((i) => i.id === id)?.label ?? id;
  const conflicts = pack.conflicts.filter((c) => t.conflictIds.includes(c.id));
  const markedByUser = profile.completed.includes(t.id);
  const d = t.deadline;

  return (
    <div className="detail__body">
      <p>{t.summary}</p>
      <p className="detail__state">{prettyDates(t.stateReason)}</p>

      {t.warnings.map((w) => (
        <p key={w} className="note note--warn">
          {prettyDates(w)}
        </p>
      ))}

      {t.requirements.length > 0 && (
        <div className="detail__block">
          <h4>What this step needs first</h4>
          <ul className="reqs">
            {t.requirements.map((r) => (
              <li key={r.id} className={r.satisfied ? "req req--ok" : "req req--open"}>
                <span className="req__mark" aria-hidden="true">
                  {r.satisfied ? "✓" : "○"}
                </span>
                <div>
                  <p className="req__label">
                    {r.label}
                    <span className="sr-only">{r.satisfied ? " (met)" : " (not met yet)"}</span>
                  </p>
                  <p className="req__meta">
                    <span className={`basis basis--${r.basis}`}>{BASIS_LABEL[r.basis]}</span>
                    {!r.satisfied && r.unmetTasks.length > 0 && (
                      <span> Still needed: {r.unmetTasks.map(title).join(", ")}.</span>
                    )}
                    {!r.satisfied && r.unmetInputs.length > 0 && (
                      <span> Waiting for: {r.unmetInputs.map(inputLabel).join(", ")}.</span>
                    )}
                  </p>
                  {r.note && <p className="req__note">{r.note}</p>}
                  <SourceList pack={pack} ids={r.sourceIds} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {t.meanwhile.length > 0 || t.meanwhileNotes.length > 0 ? (
        <div className="detail__block">
          <h4>What you can do while you wait</h4>
          {t.meanwhile.length > 0 && (
            <ul className="plain">
              {t.meanwhile.map((m) => (
                <li key={m.taskId}>
                  {title(m.taskId)}
                  {m.helpsThisTask ? " (also moves this step forward)" : ""}
                </li>
              ))}
            </ul>
          )}
          {t.meanwhileNotes.map((n) => (
            <div key={n.text}>
              <p>{n.text}</p>
              <SourceList pack={pack} ids={n.sourceIds} />
            </div>
          ))}
        </div>
      ) : null}

      <div className="detail__block">
        <h4>Deadline</h4>
        <p>
          <span className={`basis basis--kind-${d.kind}`}>{DEADLINE_KIND_LABEL[d.kind]}</span>
          {d.date && (
            <>
              {" "}
              <strong>
                {fmtDate(d.date)}
                {typeof d.daysLeft === "number" ? ` (${daysPhrase(d.daysLeft)})` : ""}
              </strong>
            </>
          )}
        </p>
        <p>{prettyDates(d.text)}</p>
        {d.status === "needs_input" && d.missingInput && (
          <p className="note">Add your {inputLabel(d.missingInput).toLowerCase()} to see the date.</p>
        )}
        <SourceList pack={pack} ids={d.sourceIds} />
      </div>

      {conflicts.map((c) => (
        <div key={c.id} className="note note--conflict">
          <h4>Sources disagree: {c.topic}</h4>
          <p>{c.display}</p>
          <ul className="plain">
            {c.statements.map((s) => (
              <li key={s.text}>
                {s.text}
                <SourceList pack={pack} ids={s.sourceIds} />
              </li>
            ))}
          </ul>
        </div>
      ))}

      {t.openQuestions.length > 0 && (
        <div className="detail__block">
          <h4>Not verified yet</h4>
          <ul className="plain">
            {t.openQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      {t.mode === "tracked" && (!t.done || markedByUser) && (
        <div className="detail__actions">
          {markedByUser ? (
            <button type="button" className="btn btn--outline" onClick={() => onSetDone(t.id, false)}>
              Undo done
            </button>
          ) : (
            <button type="button" className="btn btn--ink" onClick={() => onSetDone(t.id, true)}>
              Mark as done
            </button>
          )}
        </div>
      )}
    </div>
  );
}
