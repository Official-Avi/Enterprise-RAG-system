import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import packageJson from "../../../package.json";
import { DemoOnly } from "./LandingNav";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version;

const link =
  "inline-flex min-h-11 items-center text-sm text-muted transition-colors duration-150 hover:text-text sm:min-h-8";

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-[13px] font-semibold">{title}</h2>
      <ul className="mt-2">{children}</ul>
    </div>
  );
}

/** §3.8: four columns on desktop, two on mobile, plus the version row. */
export function LandingFooter() {
  return (
    <footer className="mt-18 border-t border-border sm:mt-28">
      <div className="mx-auto max-w-[1152px] px-4 py-12">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4">
          <div>
            <p className="flex items-center gap-2 text-base font-semibold">
              <span className="inline-flex shrink-0 rounded-full dark:ring-1 dark:ring-border-strong">
                <Logo size={28} />
              </span>
              RackFlow AI
            </p>
            <p className="mt-2 text-sm text-muted">Ask your documents. See the source.</p>
          </div>
          <Column title="Product">
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
          </Column>
          <Column title="Try it">
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
          </Column>
          <Column title="Help">
            <li>
              <a href="#faq" className={link}>
                Questions
              </a>
            </li>
            <li>
              <a href="#faq-roles" className={link}>
                Roles and permissions
              </a>
            </li>
          </Column>
        </div>
        <p className="mt-10 border-t border-border pt-6 text-[13px] text-muted">
          © 2026 RackFlow AI · v{APP_VERSION}
          <DemoOnly optimistic={false}> · Demo mode is on. Demo accounts are shared.</DemoOnly>
        </p>
      </div>
    </footer>
  );
}
