import gold from "../src/data/qa-gold.json";
import heldout from "../src/data/qa-gold-heldout.json";
import { type GoldCase, formatReport, runEval } from "../src/lib/qa/eval";
import { berlinQA } from "../src/lib/qa/load";

let allPass = true;
for (const [name, set] of [
  ["Main set (used while tuning)", gold],
  ["Second set (written after tuning, run once)", heldout],
] as const) {
  const { results, summary } = runEval(set.cases as GoldCase[], { ...berlinQA, todayISO: "2026-10-29" });
  console.log(`\n== ${name}`);
  console.log(formatReport(results, summary));
  allPass = allPass && summary.passed === summary.total;
}
process.exitCode = allPass ? 0 : 1;
