import { answerQuestion } from "@/lib/qa/answer";
import { berlinQA } from "@/lib/qa/load";

const MAX_QUESTION_CHARS = 500;

/**
 * POST /api/ask  { "question": string, "today"?: "YYYY-MM-DD" }
 * Returns a QAResponse: an answer with citations, an abstention, or a refusal.
 * No model is called: answers are extracted from saved, cited passages.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const { question, today } = (body ?? {}) as { question?: unknown; today?: unknown };
  if (typeof question !== "string" || question.trim().length === 0) {
    return Response.json({ error: "\"question\" must be a non-empty string." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return Response.json(
      { error: `"question" must be at most ${MAX_QUESTION_CHARS} characters.` },
      { status: 400 },
    );
  }

  // The demo date control may pass a date; otherwise use the server's today.
  const todayISO =
    typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today)
      ? today
      : new Date().toISOString().slice(0, 10);

  return Response.json(answerQuestion(question, { ...berlinQA, todayISO }));
}
