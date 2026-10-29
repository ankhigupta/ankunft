/**
 * Tokenising for retrieval. Deliberately small and deterministic:
 * fold accents, drop filler words, light stemming, and a short, reviewable
 * list of German/English term equivalences for this domain.
 */

const STOPWORDS = new Set(
  (
    "a an the and or but if then so of to in on at by for with from as into about over under " +
    "is are am was were be been being do does did done can could should would will shall may might " +
    "i me my mine we us our you your he she it its they them their this that these those there here " +
    "what when where which who whom whose why how long much many some any all no not yes " +
    "have has had having get got getting need needs want wants tell please also just only very " +
    "after before while during up out than too more most other such own same " +
    "show best way find know check until alone thing things fur"
  ).split(/\s+/),
);

/** German compound terms that must match several English words. Keys are accent-folded. */
const EXPAND: Record<string, string[]> = {
  wohnungsgeberbestatigung: ["landlord", "confirmation"],
  wohnungsgeber: ["landlord"],
  meldebestatigung: ["registration", "confirmation"],
  meldebehorde: ["registration", "office"],
  krankenversicherung: ["health", "insurance"],
  aufenthaltstitel: ["residence", "permit"],
  aufenthaltserlaubnis: ["residence", "permit"],
  auslanderbehorde: ["immigration", "office"],
  sperrkonto: ["blocked", "account"],
  rundfunkbeitrag: ["broadcasting", "contribution"],
  gez: ["broadcasting", "contribution"],
  steuer: ["tax"],
  steueridentifikationsnummer: ["tax", "identification", "number"],
  einzug: ["move"],
  immatrikulation: ["enrolment"],
};

/** Words that mean the same thing for retrieval. First word is the canonical form. */
const GROUPS: string[][] = [
  ["register", "registration", "anmeldung", "anmelden", "registry"],
  ["fee", "free", "gratis", "kostenlos", "cost", "price", "pay", "payment", "charge", "eur", "euro"],
  ["apply", "application", "applicant", "submit", "submitting", "submitted"],
  ["insurance", "insured", "insure", "insurer"],
  ["confirm", "confirmation", "certificate", "attestation"],
  ["enrol", "enroll", "enrolment", "enrollment", "matriculation"],
  ["move", "moving", "moved", "movein", "relocate", "leave", "leaving"],
  ["fund", "funds", "livelihood", "financing", "financial", "money", "lebensunterhalt", "afford"],
  ["document", "documents", "unterlagen", "paperwork", "paper", "papers"],
  ["require", "requirement", "mandatory", "necessary", "obligation", "obliged"],
  ["bank", "konto"],
  ["university", "uni", "college", "hochschule"],
  ["immigration", "foreigner", "lea", "foreigners", "landesamt", "einwanderung"],
  ["landlord", "lessor", "owner"],
  ["dwelling", "flat", "apartment", "accommodation", "housing", "wohnung"],
  ["deregister", "deregistration", "abmeldung", "abmelden", "unregister", "cancel"],
  ["withdraw", "withdrawal", "withdrawing"],
  ["electronic", "plastic", "card", "eat"],
  ["proof", "prove", "proving", "evidence"],
  ["sufficient", "enough", "valid", "accept", "recognise", "recognize", "recognised", "recognized", "count"],
  ["step", "steps", "order", "sequence"],
  ["foreign", "abroad", "overseas", "india", "indian"],
  ["ignore", "respond", "reply"],
  ["parent", "parents", "parental", "mother", "father"],
  ["letter", "write", "mail", "post"],
  ["expire", "expiry", "expiration", "end", "ends", "ending"],
  ["deadline", "frist", "within", "day", "week", "limit", "due", "late"],
  ["earliest", "early", "earlier", "ahead", "advance"],
  ["process", "processing", "take", "arrive", "arrival", "wait", "waiting", "duration", "came", "come", "receive", "received", "land", "landed"],
];

export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase();
}

export function stem(t: string): string {
  if (/^\d+$/.test(t) || t.length <= 3) return t;
  let s = t;
  if (s.endsWith("ies") && s.length > 4) s = s.slice(0, -3) + "y";
  else if (s.endsWith("sses")) s = s.slice(0, -2);
  else if (s.endsWith("s") && !s.endsWith("ss") && !s.endsWith("us") && !s.endsWith("is")) s = s.slice(0, -1);
  if (s.endsWith("ly") && s.length > 5) s = s.slice(0, -2);
  if (s.endsWith("ing") && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith("ied") && s.length > 4) s = s.slice(0, -3) + "y";
  else if (s.endsWith("ed") && s.length > 4) s = s.slice(0, -2);
  if (s.endsWith("e") && s.length > 3) s = s.slice(0, -1);
  return s;
}

const CANON = new Map<string, string>();
for (const group of GROUPS) {
  const canon = stem(group[0]);
  for (const w of group) CANON.set(stem(w), canon);
}

export function tokenize(text: string): string[] {
  // "visa-free" is about visas, not about fees.
  const words = fold(text)
    .replace(/visa[- ]free/g, "visafree")
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    const parts = EXPAND[w] ?? [w];
    for (const p of parts) {
      if (STOPWORDS.has(p)) continue;
      if (p.length === 1 && !/\d/.test(p)) continue;
      if (/^\d+(st|nd|rd|th)$/.test(p)) continue; // "the 3rd" says nothing about the topic
      const s = stem(p);
      out.push(CANON.get(s) ?? s);
    }
  }
  return out;
}
