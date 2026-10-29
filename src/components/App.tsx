"use client";

import { useEffect, useMemo, useState } from "react";
import { SCENARIOS, type Scenario } from "@/lib/demo";
import { fmtDate, prettyDates } from "@/lib/format";
import { berlinPack } from "@/lib/pack/load";
import type { Profile } from "@/lib/pack/schema";
import { buildPlan } from "@/lib/planner/engine";
import { Ask } from "./Ask";
import { Board } from "./Board";
import { IntakeFields } from "./Intake";
import { NextPlate } from "./NextPlate";

const STORAGE_KEY = "ankunft.v1";
const EMPTY: Profile = { inputs: {}, completed: [] };

function realToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type Saved = { profile: Profile; todayOverride: string | null };

export function App() {
  const pack = berlinPack;
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [todayOverride, setTodayOverride] = useState<string | null>(null);
  const [today, setToday] = useState("");
  const [showIntake, setShowIntake] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  // Load once in the browser. Storage can be blocked, so nothing depends on it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser state after mount
    setToday(realToday());
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Saved;
        if (saved?.profile?.inputs) {
          setProfile({ inputs: saved.profile.inputs, completed: saved.profile.completed ?? [] });
          setTodayOverride(saved.todayOverride ?? null);
          setShowIntake(!saved.profile.inputs.entryType);
        }
      }
    } catch {
      /* storage unavailable: start empty */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile, todayOverride } satisfies Saved));
    } catch {
      /* ignore */
    }
  }, [ready, profile, todayOverride]);

  const effectiveToday = todayOverride ?? today;
  const hasEntry = typeof profile.inputs.entryType === "string";
  const plan = useMemo(
    () => (ready && hasEntry && effectiveToday ? buildPlan(pack, profile, effectiveToday) : null),
    [pack, profile, effectiveToday, ready, hasEntry],
  );

  function loadScenario(s: Scenario) {
    setProfile(s.profile);
    setTodayOverride(s.today);
    setOpenId(null);
    setShowIntake(false);
  }

  function setDone(id: string, done: boolean) {
    setProfile((p) => ({
      ...p,
      completed: done ? [...new Set([...p.completed, id])] : p.completed.filter((x) => x !== id),
    }));
  }

  function openTask(id: string) {
    setOpenId(id);
    requestAnimationFrame(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(`row-${id}`)?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    });
  }

  function reset() {
    setProfile(EMPTY);
    setTodayOverride(null);
    setOpenId(null);
    setShowIntake(true);
  }

  return (
    <div className="page">
      <header className="masthead">
        <h1 className="masthead__name">Ankunft</h1>
        <p className="masthead__tag">
          Your first weeks in Berlin, in the right order. Every rule shows its official source and whether it
          is law or our own inference.
        </p>
      </header>

      <main>
        <section className="situation" aria-labelledby="situation-title">
          <div className="situation__bar">
            <h2 id="situation-title" className="situation__title">
              Your situation
            </h2>
            <button
              type="button"
              className="btn btn--outline btn--small"
              aria-expanded={showIntake}
              aria-controls="intake"
              onClick={() => setShowIntake((v) => !v)}
            >
              {showIntake ? "Hide details" : "Edit details"}
            </button>
          </div>

          <div className="examples">
            <p className="examples__lead">Try an example</p>
            <ul>
              {SCENARIOS.map((s) => (
                <li key={s.id}>
                  <button type="button" className="example" onClick={() => loadScenario(s)}>
                    <span className="example__label">{s.label}</span>
                    <span className="example__blurb">{s.blurb}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {showIntake && (
            <div id="intake" className="intake">
              {ready && (
                <>
                  <IntakeFields pack={pack} profile={profile} onChange={setProfile} />
                  <details className="demo">
                    <summary>Change today&apos;s date (for demos)</summary>
                    <div className="field">
                      <label htmlFor="today-override">Pretend today is</label>
                      <input
                        id="today-override"
                        type="date"
                        value={todayOverride ?? ""}
                        onChange={(e) => setTodayOverride(e.target.value || null)}
                      />
                      <p className="field__help">
                        Deadlines are calculated from this date. Leave it empty to use the real date
                        {today ? ` (${fmtDate(today)})` : ""}.
                      </p>
                    </div>
                  </details>
                  <button type="button" className="linkish" onClick={reset}>
                    Clear everything
                  </button>
                </>
              )}
            </div>
          )}
        </section>

        {todayOverride && (
          <p className="note note--warn" role="status">
            Demo date: this plan is calculated as if today were {fmtDate(todayOverride)}.{" "}
            <button type="button" className="linkish" onClick={() => setTodayOverride(null)}>
              Use today&apos;s real date{today ? ` (${fmtDate(today)})` : ""}
            </button>
          </p>
        )}

        {ready && !hasEntry && (
          <p className="empty">
            Choose how you entered Germany, or pick an example above, and your plan appears here.
          </p>
        )}

        {plan && !plan.supported && (
          <section className="plate plate--quiet" aria-labelledby="unsupported-title">
            <h2 id="unsupported-title" className="plate__title">
              This situation is not covered yet
            </h2>
            <p className="plate__reason">{plan.unsupportedReason}</p>
            <p className="plate__line">
              Ankunft would rather say so than guess. Berlin and non-EU students on a national study visa are
              the first supported case.
            </p>
          </section>
        )}

        {plan?.supported && (
          <>
            {plan.profileIssues.length > 0 && (
              <div className="issues" role="alert">
                {plan.profileIssues.map((i) => (
                  <p key={i} className="note note--warn">
                    {prettyDates(i)}
                  </p>
                ))}
              </div>
            )}
            <NextPlate plan={plan} onOpenTask={openTask} onMarkDone={(id) => setDone(id, true)} />
            {plan.inputsNeeded.length > 0 && (
              <p className="prompt">
                More dates give you more deadlines. Add:{" "}
                {plan.inputsNeeded.map((n) => n.label.toLowerCase()).join("; ")}.
              </p>
            )}
            <Board
              pack={pack}
              plan={plan}
              profile={profile}
              openId={openId}
              onToggle={(id) => setOpenId((cur) => (cur === id ? null : id))}
              onSetDone={setDone}
            />
          </>
        )}

        {ready && <Ask today={effectiveToday || realToday()} />}
      </main>

      <footer className="foot">
        <p>
          Rules checked against official sources on {fmtDate(pack.verifiedOn)} (Berlin pack {pack.version}).
          {plan?.packStale ? " That was a while ago, so re-check the linked pages before you rely on a date." : ""}
        </p>
        <p>Ankunft is a planning aid, not legal advice. Only the authorities decide your case.</p>
      </footer>
    </div>
  );
}
