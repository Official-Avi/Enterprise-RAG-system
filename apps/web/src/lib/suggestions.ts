// Suggested questions for an empty chat (Docs/UI_DESIGN_SPEC.md §5.11).
import type { DocumentItem } from "./types";

export interface Suggestion {
  question: string;
  filename: string | null;
}

const MAX_SUGGESTIONS = 4;
const MAX_FROM_FILENAMES = 3;
const MAX_TITLE_CHARS = 60;

const FALLBACK = [
  "What are the key dates and deadlines?",
  "Who is responsible for what?",
  "What are the most important numbers?",
];

const TEMPLATES: { keyword: RegExp; question: (title: string) => string }[] = [
  {
    keyword: /^(polic(y|ies)|handbooks?|guides?|guidelines?|procedures?)$/,
    question: (t) => `What are the main rules in the ${t}?`,
  },
  {
    keyword: /^(contracts?|agreements?|terms)$/,
    question: (t) => `What are the termination terms in the ${t}?`,
  },
  {
    keyword: /^(reports?|reviews?|incidents?)$/,
    question: (t) => `What are the key findings in the ${t}?`,
  },
  {
    keyword: /^(runbooks?|manuals?|specs?|specifications?)$/,
    question: (t) => `What steps are listed in the ${t}?`,
  },
  {
    keyword: /^(invoices?|budgets?)$/,
    question: (t) => `What amounts and due dates are in the ${t}?`,
  },
];

// Filenames made of these words (plus digits) say nothing about the content: "scan3", "Untitled document".
const GENERIC = new Set([
  "scan", "scanned", "scanner", "untitled", "unnamed", "noname", "document", "documents", "doc", "docs",
  "file", "files", "image", "img", "photo", "pic", "picture", "page", "new", "download", "attachment",
  "screenshot", "screen", "shot", "dsc", "dscn", "cam", "export", "print", "printout", "temp", "tmp", "test",
]);

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "vs", "with"]);

const MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_PATTERNS = [
  "(?:19|20)\\d{2}[-. ](?:0?[1-9]|1[0-2])(?:[-. ](?:0?[1-9]|[12]\\d|3[01]))?", // 2024-03-15, 2024-03
  "\\d{1,2}(?<sep>[-. ])\\d{1,2}\\k<sep>(?:\\d{4}|\\d{2})", // 15.03.2024, 03-15-24
  "(?:19|20)\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])", // 20240315
  `(?:\\d{1,2}[-. ]?)?${MONTH}[-. ,]*(?:19|20)\\d{2}`, // 15 Mar 2024, March-2024
];
// A lone year ("Annual Report 2024") is kept: it tells documents apart and isn't a date stamp.
const DATE_RE = new RegExp(DATE_PATTERNS.map((p) => `(?<![A-Za-z0-9])${p}(?![A-Za-z0-9])`).join("|"), "gi");
const VERSION_RE = /(?<![A-Za-z0-9])v\d+(?:\.\d+)*(?![A-Za-z0-9])/gi;

function titleCaseWord(word: string, index: number, allCaps: boolean): string {
  const lower = word.toLowerCase();
  if (index > 0 && SMALL_WORDS.has(lower)) return lower;
  const hasLower = /[a-z]/.test(word);
  const hasUpper = /[A-Z]/.test(word);
  if (hasLower && hasUpper) return word; // "iPhone", "McKinsey", "Handbook"
  if (hasLower) return word.charAt(0).toUpperCase() + word.slice(1);
  // An acronym ("HR", "GDPR") stays upper-case; a shouted name ("EMPLOYEE HANDBOOK") doesn't.
  if (hasUpper && word.length <= (allCaps ? 3 : 5)) return word;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** A readable title from a filename, or null when the name says nothing ("scan3", "IMG_0042"). */
export function cleanTitle(filename: string): string | null {
  // Up to 8 characters so ".markdown" goes too; the lookahead keeps "v1.2" and "2024.03".
  let s = filename.replace(/^.*[\\/]/, "").replace(/\.(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{1,8}$/, "");
  s = s.replace(/_/g, " ");
  s = s.replace(/\(\d+\)/g, " ").replace(/\bcopy of\b/gi, " ");
  s = s.replace(DATE_RE, " ").replace(VERSION_RE, " ");
  s = s.replace(/[-.]+/g, " ").replace(/[()[\]{}]/g, " ");
  s = s.replace(/([a-z]{2,})([A-Z][a-z])/g, "$1 $2"); // "EmployeeHandbook"

  const words = s
    .split(/\s+/)
    .map((w) => w.replace(/^[,;:+]+|[,;:+]+$/g, ""))
    .filter((w) => w && !/^(final|copy)$/i.test(w));
  if (words[0]?.toLowerCase() === "the") words.shift();
  if (words.length === 0) return null;

  const joined = words.join(" ");
  const letters = (joined.match(/[A-Za-z]/g) ?? []).length;
  const digits = (joined.match(/\d/g) ?? []).length;
  if (letters < 3 || digits > letters) return null;
  if (words.every((w) => !w.replace(/\d/g, "") || GENERIC.has(w.replace(/\d/g, "").toLowerCase()))) return null;
  if (joined.length > MAX_TITLE_CHARS) return null;

  const allCaps = !/[a-z]/.test(joined);
  return words.map((w, i) => titleCaseWord(w, i, allCaps)).join(" ");
}

/** English titles end with the head noun, so the keyword nearest the end decides ("Incident Runbook" → steps). */
function questionFor(title: string): string {
  const words = title.toLowerCase().split(" ");
  for (let i = words.length - 1; i >= 0; i--) {
    const row = TEMPLATES.find((t) => t.keyword.test(words[i]));
    if (row) return row.question(title);
  }
  return `What is the ${title} about?`;
}

function newestFirst(d: DocumentItem): number {
  const t = Date.parse(d.indexed_at ?? d.created_at);
  return Number.isNaN(t) ? 0 : t;
}

/** Templates from the 3 newest Ready filenames, else the static fallback (§5.11). */
export function suggestQuestions(docs: DocumentItem[], mode: "extractive" | "llm"): Suggestion[] {
  // Never suggest a document that isn't Ready; with nothing Ready there is nothing to ask about.
  const ready = docs.filter((d) => d.status === "indexed").sort((a, b) => newestFirst(b) - newestFirst(a));
  if (ready.length === 0) return [];

  // The extractive model quotes passages; it can't summarize, so never offer that.
  const allowed = (q: string) => mode !== "extractive" || !/\bsummar/i.test(q);

  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const push = (question: string, filename: string | null) => {
    const key = question.toLowerCase();
    if (seen.has(key) || !allowed(question)) return;
    seen.add(key);
    out.push({ question, filename });
  };

  // Walk newest-first so a "scan3" among the newest doesn't hide the next good name.
  for (const doc of ready) {
    if (out.length >= MAX_FROM_FILENAMES) break;
    const title = cleanTitle(doc.filename);
    if (title) push(questionFor(title), doc.filename);
  }
  for (const question of FALLBACK) {
    if (out.length >= MAX_SUGGESTIONS) break;
    push(question, null);
  }
  return out;
}
