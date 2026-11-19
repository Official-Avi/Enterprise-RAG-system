import Image, { type StaticImageData } from "next/image";
import howAddDark from "../../../public/landing/how-add-dark.png";
import howAddLight from "../../../public/landing/how-add-light.png";
import howAskDark from "../../../public/landing/how-ask-dark.png";
import howAskLight from "../../../public/landing/how-ask-light.png";
import howCheckDark from "../../../public/landing/how-check-dark.png";
import howCheckLight from "../../../public/landing/how-check-light.png";

/** A capture of the running app in both modes. Only the one matching the current theme is
 *  displayed; the other is display:none and, being lazy, is never fetched. Plain frame: a hairline
 *  and the card radius, never a drawn browser bar. Recapture with the script named in design.md. */
export function Capture({
  light,
  dark,
  alt,
  sizes,
  className = "",
}: {
  light: StaticImageData;
  dark: StaticImageData;
  alt: string;
  sizes: string;
  className?: string;
}) {
  return (
    <figure
      data-kind="product"
      className={`overflow-hidden rounded-card border border-border bg-panel ${className}`}
    >
      <Image src={light} alt={alt} sizes={sizes} className="block h-auto w-full dark:hidden" />
      <Image src={dark} alt={alt} sizes={sizes} className="hidden h-auto w-full dark:block" />
    </figure>
  );
}

const SIZES = "(min-width: 48rem) 33vw, 100vw";

const STEPS: { title: string; body: string; light: StaticImageData; dark: StaticImageData; alt: string }[] = [
  {
    title: "Add a file",
    body: "Drag it in or choose it. Most files are ready in under a minute.",
    light: howAddLight,
    dark: howAddDark,
    alt: "The documents list in RackFlow, with each policy and runbook marked Ready.",
  },
  {
    title: "Ask a question",
    body: "Type it the way you'd ask a colleague.",
    light: howAskLight,
    dark: howAskDark,
    alt: "The question box with “How long are backups retained?” typed in, ready to send.",
  },
  {
    title: "Check the source",
    body: "Every answer shows the passage and page it came from.",
    light: howCheckLight,
    dark: howCheckDark,
    alt: "An answer saying nightly backups are kept for 35 days, with source 1 open on the quoted line from backup-policy-2026.md.",
  },
];

/** Three steps, each with a real capture of that step in the running app. */
export function HowItWorks() {
  return (
    <ol className="grid grid-cols-1 gap-16 md:grid-cols-3 md:gap-[var(--gap-columns)]">
      {STEPS.map((s, i) => (
        <li key={s.title} className="flex min-w-0 flex-col">
          <span aria-hidden="true" className="font-display text-3xl leading-none font-semibold text-muted tabular-nums">
            {i + 1}
          </span>
          <h3 className="mt-4 text-title">{s.title}</h3>
          <p className="mt-2 flex-1 text-base leading-7 text-text-2">{s.body}</p>
          <Capture light={s.light} dark={s.dark} alt={s.alt} sizes={SIZES} className="mt-6" />
        </li>
      ))}
    </ol>
  );
}
