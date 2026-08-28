import { Quote } from "lucide-react";
import Image from "next/image";

export function QuoteSection() {
  return (
    <section
      aria-label="A thought to carry with you"
      className="relative isolate flex min-h-[22rem] items-center overflow-hidden border-y border-white/[0.08]"
    >
      <Image
        src="/images/atmosphere/botanical-dusk.png"
        alt=""
        fill
        sizes="100vw"
        className="-z-20 object-cover object-center"
      />
      <div className="absolute inset-0 -z-10 bg-background/48" />

      <blockquote className="mx-auto w-full max-w-4xl px-6 py-20 text-center sm:px-10">
        <Quote
          aria-hidden="true"
          className="mx-auto size-9 text-champagne"
          strokeWidth={1.4}
        />
        <p className="mt-6 font-display text-[clamp(2.25rem,5vw,4.75rem)] leading-[1.04] tracking-[-0.035em] text-primary">
          Some moments become memories before we even realize it.
        </p>
        <cite className="mt-7 block text-[0.7rem] font-semibold not-italic uppercase tracking-[0.22em] text-champagne">
          Mood &amp; Moments
        </cite>
      </blockquote>
    </section>
  );
}
