import { Icon, type IconName } from "@/components/icons";

const FACTS: { icon: IconName; text: string }[] = [
  { icon: "racks", text: "Runs on your server" },
  { icon: "scan", text: "Reads scanned PDFs" },
];

/** Two plain product facts in the hero's text column, ruled like a spec sheet. They stand in for
 *  the logos and numbers we don't have, so they stay facts: no claims, no figures. */
export function FactStrip() {
  return (
    <ul className="border-t border-border">
      {FACTS.map((f) => (
        <li key={f.text} className="flex items-center gap-3 border-b border-border py-3 text-sm text-text-2">
          <Icon name={f.icon} className="shrink-0 text-accent" />
          {f.text}
        </li>
      ))}
    </ul>
  );
}
