import { Icon } from "@/components/icons";
import { OpenDetailsOnHash } from "./LandingNav";

const ITEMS: { id?: string; q: string; a: string; open?: boolean }[] = [
  {
    q: "What files can I use?",
    a: "PDF, Word (.docx), plain text and Markdown, up to 25 MB and 500 pages each. Scanned PDFs work too: RackFlow reads them with text recognition (OCR).",
    open: true,
  },
  {
    q: "How long until I can ask?",
    a: "Usually 5 to 60 seconds. You'll see Waiting, then Reading, then Ready. Scanned files take the longest.",
    open: true,
  },
  {
    q: "Does it make things up?",
    a: "RackFlow answers only from your documents. Depending on how your admin set it up, it either quotes the passages that match your question, or an AI model writes the answer from those passages. Either way the answer links to its sources so you can check it, and if nothing matches, it says so.",
  },
  {
    q: "Who can see my files?",
    a: "People in your workspace whose role allows it. The demo accounts are shared, so anyone using the demo can see what you upload.",
  },
  {
    id: "faq-roles",
    q: "Why can't Operators or Auditors upload?",
    a: "Their jobs don't involve adding documents. Operators keep processing running and can ask questions. Auditors review the activity log and never see document content.",
  },
  {
    q: "Where does my data go?",
    a: "Files are stored and searched on the server running RackFlow, and whole files are never sent anywhere else. RackFlow can run without an AI model, and then nothing leaves that server. If an admin connects one, your question and the few passages that match it go to that model to write the answer. A follow-up can include your earlier question too. The model may run on your own servers or at an outside service such as Anthropic, OpenAI or Groq, so ask your admin which one this workspace uses.",
  },
];

/** A ruled list of native disclosures; the first two start open, and a link to one opens it.
 *  The plus/minus is drawn as a small keycap: it lifts on hover and sinks while pressed. */
export function Faq() {
  return (
    <div className="border-b border-border">
      <OpenDetailsOnHash />
      {ITEMS.map((item) => (
        <details key={item.q} id={item.id} open={item.open} className="group scroll-mt-20 border-t border-border">
          <summary
            className={
              "flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 " +
              "font-display text-base font-medium text-text [&::-webkit-details-marker]:hidden " +
              "hover:text-accent focus-visible:outline-offset-4"
            }
          >
            {item.q}
            <span
              aria-hidden="true"
              className={
                "grid size-8 shrink-0 place-items-center rounded-md border border-border-2 bg-key-face text-text-2 shadow-key " +
                "transition-[transform,box-shadow,background-color] duration-[var(--dur-micro)] ease-out " +
                "group-hover:-translate-y-px group-active:translate-y-0.5 group-active:bg-panel-3 group-active:shadow-key-press"
              }
            >
              <Icon name="plus" className="group-open:hidden" />
              <svg
                viewBox="0 0 24 24"
                width={16}
                height={16}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                className="hidden group-open:block"
              >
                <path d="M5 12h14" />
              </svg>
            </span>
          </summary>
          <p className="max-w-[65ch] pb-6 text-base leading-7 text-text-2">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
