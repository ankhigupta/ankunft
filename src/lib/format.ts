import type { Basis, DeadlineKind } from "./pack/schema";
import type { TaskState } from "./planner/engine";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-04" -> "4 Nov 2026". Fixed format so server and browser agree. */
export function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** Engine sentences carry ISO dates. Show them the way people read dates. */
export function prettyDates(text: string): string {
  return text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (d) => fmtDate(d));
}

export function daysPhrase(n: number): string {
  if (n === 0) return "today";
  const abs = Math.abs(n);
  const unit = abs === 1 ? "day" : "days";
  return n > 0 ? `${abs} ${unit} left` : `${abs} ${unit} ago`;
}

export const STATE_LABEL: Record<TaskState, string> = {
  done: "Done",
  overdue: "Overdue",
  due_soon: "Due soon",
  blocked: "Waiting",
  ready: "Ready",
  info_only: "Info",
};

export const BASIS_LABEL: Record<Basis, string> = {
  legal_requirement: "Required by law",
  authority_requirement: "Required by the authority",
  stated_sequence: "Order suggested by a source",
  inferred: "Our inference",
};

export const DEADLINE_KIND_LABEL: Record<DeadlineKind, string> = {
  statutory: "Deadline set by law",
  authority_stated: "Deadline set by the authority",
  university_stated: "Guidance from universities",
  informational: "Guidance, not a fixed date",
  none_found: "No official deadline found",
};
