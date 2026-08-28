import { ArrowRight } from "lucide-react";
import Image from "next/image";

import { MoodIcon } from "@/components/ui/mood-icon";
import { moods, recentMoments } from "@/data/moments";

export function RecentMoments() {
  return (
    <section
      id="moments"
      aria-labelledby="recent-moments-title"
      className="scroll-mt-24 py-20 sm:py-24 lg:py-28"
    >
      <div className="mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="mb-8 flex items-end justify-between gap-6 border-b border-white/[0.08] pb-5 sm:mb-10">
          <div>
            <p className="eyebrow">Held close</p>
            <h2
              id="recent-moments-title"
              className="mt-3 font-display text-[clamp(2.5rem,4.5vw,4.25rem)] leading-none tracking-[-0.035em] text-primary"
            >
              Recent Moments
            </h2>
          </div>
          <a
            href="#timeline"
            className="hidden min-h-11 items-center gap-2 rounded-sm text-sm font-medium text-champagne transition-colors hover:text-primary focus-visible:outline-none sm:inline-flex"
          >
            View the timeline
            <ArrowRight aria-hidden="true" className="size-4" />
          </a>
        </div>

        <div className="border-x border-white/[0.08]">
          {recentMoments.map((moment, index) => {
            const mood = moods.find((item) => item.id === moment.mood);
            const reverse = index % 2 === 1;

            return (
              <article
                key={moment.id}
                className="group grid border-b border-white/[0.08] first:border-t min-[900px]:grid-cols-2"
              >
                <div
                  className={`relative aspect-[3/2] overflow-hidden bg-muted-surface ${
                    reverse ? "min-[900px]:order-2" : ""
                  }`}
                >
                  {moment.image ? (
                    <Image
                      src={moment.image.src}
                      alt={moment.image.alt}
                      width={1536}
                      height={1024}
                      sizes="(max-width: 639px) calc(100vw - 40px), (max-width: 899px) calc(100vw - 64px), (max-width: 1023px) calc((100vw - 64px) / 2), (max-width: 1439px) calc((100vw - 96px) / 2), 672px"
                      className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.025]"
                    />
                  ) : null}
                  <div className="pointer-events-none absolute inset-0 border border-white/[0.06] bg-background/5" />
                </div>

                <div
                  className={`flex min-h-full flex-col justify-center bg-elevated/70 px-6 py-9 sm:px-9 sm:py-12 lg:px-12 xl:px-16 ${
                    reverse ? "min-[900px]:order-1" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 text-[0.7rem] font-semibold uppercase tracking-[0.13em] text-secondary/80">
                    <time dateTime={moment.dateTime}>
                      {moment.date} <span aria-hidden="true">·</span>{" "}
                      {moment.time}
                    </time>
                    {mood ? (
                      <span className="inline-flex items-center gap-2 normal-case tracking-normal text-rose-soft">
                        <MoodIcon mood={moment.mood} className="size-4" />
                        {mood.label}
                      </span>
                    ) : null}
                  </div>

                  <h3 className="mt-7 max-w-[18ch] font-display text-[clamp(2rem,3.5vw,3.3rem)] leading-[1.02] tracking-[-0.03em] text-primary">
                    {moment.title}
                  </h3>
                  <p className="mt-5 max-w-[34rem] text-[0.95rem] leading-7 text-secondary sm:text-base">
                    {moment.excerpt}
                  </p>
                  <span
                    aria-hidden="true"
                    className="mt-8 inline-flex size-11 items-center justify-center self-end rounded-full border border-white/10 text-primary transition duration-300 group-hover:border-rose/50 group-hover:text-rose-soft"
                  >
                    <ArrowRight aria-hidden="true" className="size-5" />
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
