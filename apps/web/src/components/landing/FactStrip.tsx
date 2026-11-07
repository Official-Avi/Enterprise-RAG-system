import { Icon, type IconName } from "@/components/icons";

const FACTS: { icon: IconName; title: string; body: string }[] = [
  { icon: "racks", title: "Runs on your server", body: "Your files stay where RackFlow is installed." },
  { icon: "quote", title: "Every answer cites its page", body: "Click a number to read the quote." },
  { icon: "scan", title: "Reads scanned PDFs", body: "Text recognition is built in." },
];

/** Three plain product facts under the hero card (§3.1), in place of logos we don't have. */
export function FactStrip() {
  return (
    <ul className="mx-auto grid w-fit gap-5 text-left sm:w-full sm:grid-cols-3 sm:gap-6">
      {FACTS.map((f) => (
        <li key={f.title} className="flex gap-3">
          <Icon name={f.icon} width={20} height={20} className="mt-px shrink-0 text-accent" />
          <div>
            <p className="text-[15px] font-semibold leading-[22px]">{f.title}</p>
            <p className="mt-0.5 text-[13px] leading-5 text-muted">{f.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
