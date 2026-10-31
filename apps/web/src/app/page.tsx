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

const H1 =
  "font-display text-[length:clamp(2rem,1.25rem_+_2.5vw,2.75rem)] font-bold leading-[1.1] tracking-[-0.02em] text-balance";
const H2 =
  "font-display text-[length:clamp(1.75rem,1.4rem_+_1.2vw,2.25rem)] font-bold leading-[1.15] tracking-[-0.018em] text-balance";

/** A standard landing section: 840px column, 112px (72px on mobile) above, centred H2. */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mx-auto mt-18 max-w-[872px] scroll-mt-20 px-4 sm:mt-28">
      <h2 id={`${id}-title`} className={`text-center ${H2}`}>
        {title}
      </h2>
      <div className="mt-10">{children}</div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <VisitorProvider>
      <div className="min-h-dvh bg-landing-bg">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-panel focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-elev-3"
        >
          Skip to main content
        </a>
        <LandingNav />

        <main id="main" className="overflow-x-clip">
          {/* Hero: the working tool is the hero (§1.1). */}
          <section aria-labelledby="hero-title" className="mx-auto max-w-[872px] px-4 pt-8 text-center sm:pt-12">
            <h1 id="hero-title" className={H1}>
              Ask your documents. <span className="text-accent">See the exact page.</span>
            </h1>
            <p className="mx-auto mt-3 max-w-[600px] text-lg leading-7 text-muted">
              Upload a PDF, Word or text file and ask in plain words. Every answer quotes the passage and page it came
              from.
            </p>
            <div className="mt-8 text-left">
              <HeroUpload />
            </div>
            <div className="mt-10">
              <FactStrip />
            </div>
          </section>

          <DemoOnly>
            <section id="demo" aria-labelledby="demo-title" className="mx-auto mt-12 max-w-[1072px] scroll-mt-20 px-4">
              <p className="mx-auto flex max-w-[840px] items-center gap-4 text-sm text-muted">
                <span aria-hidden="true" className="h-px flex-1 bg-border" />
                or try a demo account
                <span aria-hidden="true" className="h-px flex-1 bg-border" />
              </p>
              <div className="mt-10 text-center">
                <h2 id="demo-title" className={H2}>
                  Try it with a demo account
                </h2>
                <p className="mx-auto mt-3 max-w-[600px] text-base leading-[26px] text-muted">
                  No sign-up and no password. Each account sees a different part of RackFlow.
                </p>
              </div>
              <div className="mt-8">
                <DemoPersonaCards variant="landing" />
              </div>
              <p className="mt-6 text-center text-[13px] text-muted">
                Have your own account?{" "}
                <Link href="/login" className="font-semibold text-accent underline-offset-2 hover:underline">
                  Sign in
                </Link>
              </p>
            </section>
          </DemoOnly>

          <Section id="how" title="How it works">
            <HowItWorks />
          </Section>

          <Section id="features" title="Made for answers you can trust">
            <Features />
          </Section>

          <Section id="try" title="Try it with your own file">
            <div className="text-left">
              <HeroUpload variant="compact" />
            </div>
            <DemoOnly>
              <p className="mt-5 text-center text-sm">
                <a
                  href="#demo"
                  className="inline-flex min-h-11 items-center font-medium text-accent underline-offset-2 hover:underline sm:min-h-8"
                >
                  or pick a demo account
                </a>
              </p>
            </DemoOnly>
          </Section>

          <Section id="faq" title="Questions">
            <Faq />
          </Section>
        </main>

        <LandingFooter />
      </div>
    </VisitorProvider>
  );
}
