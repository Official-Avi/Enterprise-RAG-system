import { Icon } from "@/components/icons";

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
    a: "By default no AI model writes the answer: RackFlow quotes the passages that match your question. If an admin turns on Claude, Claude writes the answer from those passages, and every claim still links to its source. If nothing matches, it says so.",
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
    a: "Files are stored and searched on the server running RackFlow. In the default mode nothing is sent to an outside AI service. If Claude is turned on, only your question and the few matching passages go to Anthropic to write the answer.",
  },
];

/** §3.7: native disclosure widgets; the first two start open. */
export function Faq() {
  return (
    <div className="mx-auto max-w-[820px] space-y-2">
      {ITEMS.map((item) => (
        <details
          key={item.q}
          id={item.id}
          open={item.open}
          className="group scroll-mt-20 rounded-xl bg-panel-2"
        >
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-3 text-base font-semibold leading-6 [&::-webkit-details-marker]:hidden">
            {item.q}
            <Icon
              name="plus"
              width={18}
              height={18}
              className="shrink-0 text-muted transition-transform duration-150 group-open:rotate-45"
            />
          </summary>
          <p className="px-5 pb-5 text-[15px] leading-6 text-muted">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
