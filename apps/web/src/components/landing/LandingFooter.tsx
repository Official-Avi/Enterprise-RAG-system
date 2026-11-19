import Link from "next/link";
import { Logo } from "@/components/Logo";
import packageJson from "../../../package.json";
import { DemoOnly } from "./LandingNav";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version;

/** Footer links: muted until hovered or focused, underlined then, 44px on touch. */
const link =
  "inline-flex min-h-11 items-center text-sm text-text-2 underline-offset-4 transition-colors duration-(--dur-micro) " +
  "hover:text-text hover:underline focus-visible:text-text focus-visible:underline active:text-accent sm:min-h-8";

/** design.md § Landing 8: a colophon block. It sits straight under the FAQ well, whose bottom rule is its top edge.
 *  The wordmark and product line, the page's real links in one run,
 *  then the legal line under a hairline. */
export function LandingFooter() {
  return (
    <footer>
      <div className="mx-auto w-full max-w-(--container) px-(--gutter) pt-10 pb-10 sm:pt-16">
        <div className="grid gap-y-6 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-x-16">
          <div>
            <p className="flex items-center gap-2 font-display text-lg font-semibold text-text">
              <span className="inline-flex shrink-0 rounded-full dark:ring-1 dark:ring-border-strong">
                <Logo size={28} />
              </span>
              RackFlow AI
            </p>
            <p className="mt-3 max-w-[44ch] text-sm text-muted">Ask your documents. See the source.</p>
          </div>
          <ul className="flex flex-wrap content-start items-center gap-x-6 lg:justify-end">
            <li>
              <a href="#how" className={link}>
                How it works
              </a>
            </li>
            <li>
              <a href="#features" className={link}>
                Features
              </a>
            </li>
            <li>
              <a href="#faq" className={link}>
                Questions
              </a>
            </li>
            <DemoOnly>
              <li>
                <a href="#demo" className={link}>
                  Demo accounts
                </a>
              </li>
            </DemoOnly>
            <li>
              <Link href="/login" className={link}>
                Sign in
              </Link>
            </li>
            <li>
              <a href="#faq-roles" className={link}>
                Roles and permissions
              </a>
            </li>
          </ul>
        </div>
        <p className="mt-10 border-t border-border pt-6 text-xs text-muted">
          © 2026 RackFlow AI, <span className="tabular-nums">v{APP_VERSION}</span>.
          <DemoOnly optimistic={false}> Demo mode is on: demo accounts are shared.</DemoOnly>
        </p>
      </div>
    </footer>
  );
}
