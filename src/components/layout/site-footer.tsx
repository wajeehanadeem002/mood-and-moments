import { BrandMark } from "@/components/ui/brand-mark";

const footerLinks = [
  { label: "Home", href: "#home" },
  { label: "Moods", href: "#moods" },
  { label: "Moments", href: "#moments" },
  { label: "Timeline", href: "#timeline" },
] as const;

export function SiteFooter() {
  return (
    <footer className="bg-background">
      <div className="mx-auto w-full max-w-[1440px] px-5 py-14 sm:px-8 sm:py-16 lg:px-12">
        <div className="grid gap-10 border-b border-white/[0.08] pb-12 md:grid-cols-[1.25fr_0.75fr] md:items-end">
          <div className="max-w-md">
            <a
              href="#home"
              aria-label="Mood & Moments home"
              className="inline-flex min-h-11 items-center gap-3 rounded-sm text-primary focus-visible:outline-none"
            >
              <BrandMark />
              <span className="font-display text-2xl tracking-[-0.02em]">
                Mood &amp; Moments
              </span>
            </a>
            <p className="mt-5 text-sm leading-6 text-secondary">
              A quiet place to notice how you feel, hold onto what matters,
              and return to the moments that made you.
            </p>
          </div>

          <nav aria-label="Footer navigation" className="md:justify-self-end">
            <ul className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm text-secondary sm:flex sm:flex-wrap sm:gap-6">
              {footerLinks.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="inline-flex min-h-11 min-w-11 items-center rounded-sm transition-colors hover:text-primary focus-visible:outline-none"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="flex flex-col gap-2 pt-6 text-xs text-secondary sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Mood &amp; Moments. All rights reserved.</p>
          <p>Made for the feelings worth remembering.</p>
        </div>
      </div>
    </footer>
  );
}
