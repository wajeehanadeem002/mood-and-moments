"use client";

import { Menu, X } from "lucide-react";
import { useState } from "react";

import { BrandMark } from "@/components/ui/brand-mark";

const navigation = [
  { label: "Home", href: "#home" },
  { label: "Moods", href: "#moods" },
  { label: "Moments", href: "#moments" },
  { label: "Timeline", href: "#timeline" },
] as const;

export function SiteHeader() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-background/88 backdrop-blur-xl">
      <div className="mx-auto flex min-h-20 w-full max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
        <a
          href="#home"
          className="group inline-flex min-h-11 items-center gap-3 rounded-sm text-primary focus-visible:outline-none"
          aria-label="Mood & Moments home"
        >
          <BrandMark className="transition-transform duration-300 group-hover:-rotate-6" />
          <span className="font-display text-[1.45rem] tracking-[-0.02em]">
            Mood &amp; Moments
          </span>
        </a>

        <nav
          aria-label="Primary navigation"
          className="hidden min-[900px]:block"
        >
          <ul className="flex items-center gap-8 text-sm text-secondary">
            {navigation.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  aria-current={item.href === "#home" ? "page" : undefined}
                  className="nav-link inline-flex min-h-11 items-center rounded-sm px-2 transition-colors hover:text-primary focus-visible:outline-none"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <a
          href="#moods"
          className="button-primary hidden min-h-12 items-center justify-center px-6 text-sm font-medium min-[900px]:inline-flex"
        >
          Create a Moment
        </a>

        <button
          type="button"
          className="inline-flex size-12 items-center justify-center rounded-sm border border-white/10 text-primary transition-colors hover:border-rose/45 hover:bg-white/[0.04] focus-visible:outline-none min-[900px]:hidden"
          aria-label={isOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={isOpen}
          aria-controls="mobile-navigation"
          onClick={() => setIsOpen((current) => !current)}
        >
          {isOpen ? (
            <X aria-hidden="true" className="size-5" />
          ) : (
            <Menu aria-hidden="true" className="size-5" />
          )}
        </button>
      </div>

      {isOpen ? (
        <nav
          id="mobile-navigation"
          aria-label="Mobile navigation"
          className="border-t border-white/[0.06] bg-elevated px-5 py-5 shadow-2xl min-[900px]:hidden"
        >
          <ul className="mx-auto grid max-w-[1440px] gap-1">
            {navigation.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="flex min-h-12 items-center rounded-sm px-4 text-base text-secondary transition-colors hover:bg-white/[0.04] hover:text-primary focus-visible:outline-none"
                  onClick={() => setIsOpen(false)}
                >
                  {item.label}
                </a>
              </li>
            ))}
            <li className="pt-3">
              <a
                href="#moods"
                className="button-primary flex min-h-12 w-full items-center justify-center px-5 text-sm font-medium"
                onClick={() => setIsOpen(false)}
              >
                Create a Moment
              </a>
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
