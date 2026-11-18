import type { StaticImageData } from "next/image";
import answerDark from "../../../public/landing/feature-answer-dark.png";
import answerLight from "../../../public/landing/feature-answer-light.png";
import auditDark from "../../../public/landing/feature-audit-dark.png";
import auditLight from "../../../public/landing/feature-audit-light.png";
import notFoundDark from "../../../public/landing/feature-not-found-dark.png";
import notFoundLight from "../../../public/landing/feature-not-found-light.png";
import { Capture } from "./HowItWorks";

type Moment = { title: string; body: string };

const ROWS: { moments: [Moment, Moment]; light: StaticImageData; dark: StaticImageData; alt: string }[] = [
  {
    moments: [
      {
        title: "Answers you can check",
        body: "Every answer links to the exact passage and page. Click a number to read the quote.",
      },
      {
        title: "Reads scanned pages",
        body: "Scanned PDFs are read with text recognition, so scans of paper work too.",
      },
    ],
    light: answerLight,
    dark: answerDark,
    alt: "An answer about backup retention with three numbered sources, and the sources panel quoting each passage.",
  },
  {
    moments: [
      {
        title: "Ask the way you talk",
        body: "No keywords or filters. Type a question like you'd ask a person.",
      },
      {
        title: "Says so when it can't find it",
        body: "If your documents don't answer it, RackFlow tells you instead of guessing.",
      },
    ],
    light: notFoundLight,
    dark: notFoundDark,
    alt: "A question RackFlow could not answer from the documents, with its reply saying nothing matched and what to try next.",
  },
  {
    moments: [
      {
        title: "Four roles, one workspace",
        body: "Admins, Engineers, Operators and Auditors each see only what their job needs.",
      },
      {
        title: "Every action is recorded",
        body: "Sign-ins, uploads and setting changes are logged with who and when.",
      },
    ],
    light: auditLight,
    dark: auditDark,
    alt: "The audit log as an Auditor sees it: who did what, and when, one row per action.",
  },
];

const SIZES = "(min-width: 64rem) 58vw, 100vw";

/** Three split rows that alternate sides: two named moments beside one capture of the product
 *  doing them. Not a card grid; the captures carry the section. */
export function Features() {
  return (
    <div className="flex flex-col gap-24">
      {ROWS.map((row, i) => (
        <div
          key={row.moments[0].title}
          className={`grid grid-cols-1 items-center gap-10 lg:gap-16 ${
            i % 2 === 1 ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" : "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
          }`}
        >
          <dl className="flex flex-col gap-8">
            {row.moments.map((m) => (
              <div key={m.title} className="border-t border-border pt-6">
                <dt className="font-display text-title font-semibold text-text">{m.title}</dt>
                <dd className="mt-2 max-w-[44ch] text-base leading-7 text-text-2">{m.body}</dd>
              </div>
            ))}
          </dl>
          <Capture
            light={row.light}
            dark={row.dark}
            alt={row.alt}
            sizes={SIZES}
            className={i % 2 === 1 ? "lg:order-first" : ""}
          />
        </div>
      ))}
    </div>
  );
}
