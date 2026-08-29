import Link from "next/link";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/ui/brand-mark";

type AuthShellProps = {
  children: ReactNode;
  eyebrow: string;
  heading: string;
};

export function AuthShell({ children, eyebrow, heading }: AuthShellProps) {
  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-background px-5 py-12 sm:px-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-rose/10 blur-[120px]"
      />
      <section
        aria-labelledby="auth-title"
        className="w-full max-w-md text-center"
      >
        <Link
          href="/"
          aria-label="Mood & Moments home"
          className="group inline-flex min-h-11 items-center gap-3 rounded-sm text-primary focus-visible:outline-none"
        >
          <BrandMark className="transition-transform duration-300 group-hover:-rotate-6" />
          <span className="font-display text-[1.45rem] tracking-[-0.02em]">
            Mood &amp; Moments
          </span>
        </Link>
        <p className="eyebrow mt-10 justify-center">{eyebrow}</p>
        <h1
          id="auth-title"
          className="mt-4 font-display text-[clamp(2.6rem,8vw,4rem)] leading-[0.95] tracking-[-0.04em] text-primary"
        >
          {heading}
        </h1>
        <div className="mt-8 flex justify-center">{children}</div>
      </section>
    </main>
  );
}
