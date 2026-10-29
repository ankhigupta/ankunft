import type { QAResponse } from "./answer";

export const ASK_TIMEOUT_MS = 15_000;
const GENERIC_ERROR = "The question could not be sent. Please try again.";

/**
 * Browser side of POST /api/ask. Always settles: a hung request is aborted after
 * `timeoutMs`, so the form can never stay locked in its loading state.
 */
export async function askQuestion(
  question: string,
  today: string,
  { fetchImpl = fetch, timeoutMs = ASK_TIMEOUT_MS }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<QAResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, today }),
      signal: ctrl.signal,
    });
    let data: unknown;
    try {
      data = await r.json();
    } catch {
      throw new Error(GENERIC_ERROR);
    }
    if (!r.ok) {
      const msg = (data as { error?: unknown } | null)?.error;
      throw new Error(typeof msg === "string" ? msg : GENERIC_ERROR);
    }
    return data as QAResponse;
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error("The search took too long. Please try again.");
    throw e instanceof Error ? e : new Error(GENERIC_ERROR);
  } finally {
    clearTimeout(timer);
  }
}
