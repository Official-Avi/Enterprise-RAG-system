import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DemoPersonaCards } from "@/components/landing/DemoPersonaCards";
import { Faq } from "@/components/landing/Faq";
import { FactStrip } from "@/components/landing/FactStrip";
import { Features } from "@/components/landing/Features";
import { HeroUpload } from "@/components/landing/HeroUpload";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { DemoOnly, LandingNav } from "@/components/landing/LandingNav";
import { VisitorProvider } from "@/components/landing/Visitor";

// Static by design (§3): no cookies(), headers() or searchParams anywhere on this page.
// Everything visitor-specific happens in the client islands after hydration.

export const metadata: Metadata = {
  title: "RackFlow AI · Ask your documents, see the source",
  description:
    "Upload a PDF, Word or text file and ask in plain words. Every answer quotes the passage and page it came from.",
};

/** Joins class names; a local copy because ui.tsx is a client module and this page renders on the server. */
function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** The page column every section shares (design.md § Landing page plan). */
const CONTAINER = "mx-auto w-full max-w-(--container) px-(--gutter)";

/** Two columns from lg up: the text side (5) and the material side (7). */
const SPLIT = "grid gap-y-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-x-10 xl:gap-x-16";

/** The h1 is two lines, one phrase each (the break is the stress). With the page width it takes the full display
 *  size; on the 5-column side from lg up it takes the smaller display size capped at 48px, so "Ask your
 *  documents." (8.6 times the font size wide) stays on one line in the 420px column. */
const H1 =
  "text-display leading-[1.02] tracking-display max-[359px]:text-display-s lg:text-[length:min(var(--text-display-s),3rem)]";

/** Section heads: one colour, left-aligned, the landing section size. */
const H2 = "text-section";

/** Tertiary text link: accent ink, underline on hover and keyboard focus, 44px on touch. */
const TEXT_LINK =
  "inline-flex min-h-11 items-center font-medium text-accent underline-offset-4 hover:underline focus-visible:underline " +
  "active:text-accent-hover transition-colors duration-(--dur-micro) sm:min-h-8";

/** A landing section below the hero: its own anchor, the section gap above, clear of the sticky bar. */
function Section({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cx(CONTAINER, "mt-(--section-gap) scroll-mt-20", className)}>
      {children}
    </section>
  );
}

export default function LandingPage() {
  return (
    <VisitorProvider>
      <div className="min-h-dvh bg-landing-bg">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-4 focus:z-(--z-tooltip) focus:rounded-card focus:border focus:border-border focus:bg-panel focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-elev-3 active:bg-panel-2"
        >
          Skip to main content
        </a>
        <LandingNav />

        <main id="main" className="overflow-x-clip">
          {/* Hero, Settled: the head on the left, the working tool on the right (design.md § Landing 2). */}
          <section
            aria-labelledby="hero-title"
            className={cx(
              CONTAINER,
              SPLIT,
              "items-center pt-10 sm:pt-16 lg:pt-24",
            )}
          >
            <div className="min-w-0">
              <h1
                id="hero-title"
                className={H1}
              >
                <span className="block">Ask your documents.</span>{" "}
                <span className="block">See the exact page.</span>
              </h1>
              <p className="mt-6 max-w-[44ch] text-lead text-text-2">
                Every answer quotes the passage and the page it came from.
              </p>
            </div>
            <div className="min-w-0">
              <HeroUpload />
            </div>
          </section>

          <DemoOnly>
            <Section id="demo">
              <div className={cx(SPLIT, "gap-y-4 lg:items-end")}>
                <h2 id="demo-title" className={H2}>
                  Try it with a demo account
                </h2>
                <p className="max-w-[52ch] text-base text-text-2">
                  No sign-up and no password. Each account sees a different part of RackFlow.
                </p>
              </div>
              <div className="mt-10">
                <DemoPersonaCards variant="landing" />
              </div>
              <p className="mt-6 text-sm text-muted">
                Have your own account?{" "}
                <Link href="/login" className={TEXT_LINK}>
                  Sign in
                </Link>
              </p>
            </Section>
          </DemoOnly>

          <Section id="how">
            <h2 id="how-title" className={H2}>
              How it works
            </h2>
            <div className="mt-10">
              <HowItWorks />
            </div>
          </Section>

          <Section id="features">
            <h2 id="features-title" className={H2}>
              Made for answers you can trust
            </h2>
            <div className="mt-10">
              <Features />
            </div>
          </Section>

          <Section id="try" className={cx(SPLIT, "items-start")}>
            <div className="min-w-0">
              <h2 id="try-title" className={H2}>
                Try it with your own file
              </h2>
              <DemoOnly>
                <p className="mt-4 text-base">
                  <a href="#demo" className={TEXT_LINK}>
                    Or pick a demo account
                  </a>
                </p>
              </DemoOnly>
              {/* The product facts sit with the close, after the hero's action (Floor 58: the hero is a
                  headline, one sentence and the tool). */}
              <div className="mt-8 max-w-[44ch]">
                <FactStrip />
              </div>
            </div>
            <div className="min-w-0">
              <HeroUpload variant="compact" />
            </div>
          </Section>

          {/* The one tinted well on the page (craft.md surface ladder, Reflex 9): the other seams are whitespace
              and hairlines, this one is a full-bleed panel-2 band. The FAQ is a ruled list, so no box sits in it. */}
          <div className="mt-(--section-gap) border-y border-border bg-panel-2 py-16 sm:py-20">
            <section
              id="faq"
              aria-labelledby="faq-title"
              className={cx(CONTAINER, "grid scroll-mt-20 gap-y-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-x-16")}
            >
              <h2 id="faq-title" className={H2}>
                Questions
              </h2>
              <div className="min-w-0">
                <Faq />
              </div>
            </section>
          </div>
        </main>

        <LandingFooter />
      </div>
    </VisitorProvider>
  );
}
