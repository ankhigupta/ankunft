"use client";

import { daysPhrase, fmtDate } from "@/lib/format";
import type { Plan } from "@/lib/planner/engine";

/** "Register your address (Anmeldung)" -> ["Register your address", "Anmeldung"]. Only capitalised terms count as German. */
function splitTerm(title: string): [string, string | null] {
  const m = /^(.*?)\s*\(([A-ZÄÖÜ][^()]*)\)\s*$/.exec(title);
  return m ? [m[1], m[2]] : [title, null];
}

type Props = {
  plan: Plan;
  onOpenTask: (id: string) => void;
  onMarkDone: (id: string) => void;
};

/** The one thing to do next. It is the loudest element on the page on purpose. */
export function NextPlate({ plan, onOpenTask, onMarkDone }: Props) {
  const title = (id: string) => plan.tasks.find((t) => t.id === id)?.title ?? id;
  const next = plan.nextAction;

  if (!next) {
    return (
      <section className="plate plate--quiet" aria-labelledby="plate-title">
        <h2 id="plate-title" className="plate__title">
          Nothing is waiting on you right now
        </h2>
        <p className="plate__reason">
          Every step you can take today is done. Open the waiting steps below to see what they need.
        </p>
      </section>
    );
  }

  const task = plan.tasks.find((t) => t.id === next.taskId);
  const [mainTitle, germanTerm] = splitTerm(title(next.taskId));
  const urgent = next.urgentBecause;
  const urgentTitle = urgent ? title(urgent.taskId) : "";

  return (
    <section className="plate" aria-labelledby="plate-title">
      <p className="plate__lead">Do this next</p>
      <h2 id="plate-title" className="plate__title">
        {mainTitle}
      </h2>
      {germanTerm && (
        <p className="plate__term">
          In German: <span lang="de">{germanTerm}</span>
        </p>
      )}
      {urgent ? (
        <>
          <p className="plate__urgent">
            {urgent.taskId === next.taskId ? "" : `${urgentTitle}: `}
            {urgent.daysLeft < 0 ? "was due " : "due "}
            {fmtDate(urgent.date)} ({daysPhrase(urgent.daysLeft)})
          </p>
          {urgent.taskId !== next.taskId && (
            <p className="plate__reason">That step cannot happen until this one is done.</p>
          )}
        </>
      ) : (
        next.unlocks.length === 0 && <p className="plate__reason">Nothing else is blocking this step.</p>
      )}

      {next.unlocks.length > 0 && (
        <p className="plate__line">
          <strong>Unlocks:</strong> {next.unlocks.map(title).join("; ")}
        </p>
      )}

      {next.alsoNow.length > 0 && (
        <p className="plate__line">
          <strong>You can also start now:</strong>{" "}
          {next.alsoNow.map((id, i) => (
            <span key={id}>
              {i > 0 && "; "}
              <button type="button" className="linkish" onClick={() => onOpenTask(id)}>
                {title(id)}
              </button>
            </span>
          ))}
        </p>
      )}

      <div className="plate__actions">
        <button type="button" className="btn btn--ink" onClick={() => onOpenTask(next.taskId)}>
          See why and what you need
        </button>
        {task && task.mode === "tracked" && (
          <button type="button" className="btn btn--outline" onClick={() => onMarkDone(next.taskId)}>
            Mark as done
          </button>
        )}
      </div>
    </section>
  );
}
