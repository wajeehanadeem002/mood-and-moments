import { ArrowRight, Circle } from "lucide-react";

import { MoodIcon } from "@/components/ui/mood-icon";
import { moods, timelineMoments, type Moment } from "@/data/moments";

type MemoryTimelineProps = {
  moments?: readonly Moment[];
};

export function MemoryTimeline({
  moments = timelineMoments,
}: MemoryTimelineProps) {
  return (
    <section
      id="timeline"
      aria-labelledby="timeline-title"
      className="scroll-mt-24 border-t border-white/[0.06] bg-elevated/45 py-20 sm:py-24 lg:py-28"
    >
      <div className="mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="mb-9 flex items-end justify-between gap-6">
          <div>
            <p className="eyebrow">In your own rhythm</p>
            <h2
              id="timeline-title"
              className="mt-3 font-display text-[clamp(2.5rem,4.5vw,4.25rem)] leading-none tracking-[-0.035em] text-primary"
            >
              Memory Timeline
            </h2>
          </div>
          <p className="hidden max-w-xs text-right text-sm leading-6 text-secondary md:block">
            A quiet record of how the days felt—not just what happened.
          </p>
        </div>

        <ol className="timeline-list ml-2 border-y border-l border-white/[0.08] md:ml-0 md:border-l-0">
          {moments.map((moment) => {
            const mood = moods.find((item) => item.id === moment.mood);

            return (
              <li
                key={moment.id}
                className="timeline-item relative grid gap-3 border-b border-white/[0.07] py-6 pl-6 last:border-b-0 min-[768px]:max-[899px]:grid-cols-[8rem_7rem_minmax(13rem,1fr)_2rem] min-[768px]:max-[899px]:items-center min-[768px]:max-[899px]:gap-5 min-[768px]:max-[899px]:py-5 min-[768px]:max-[899px]:pl-0 min-[900px]:grid-cols-[9rem_8rem_minmax(13rem,0.85fr)_minmax(0,1.15fr)_3rem] min-[900px]:items-center min-[900px]:gap-6 min-[900px]:py-5 min-[900px]:pl-0"
              >
                <time
                  dateTime={moment.dateTime}
                  className="relative text-[0.7rem] font-semibold uppercase leading-5 tracking-[0.1em] text-secondary md:flex md:self-stretch md:flex-col md:justify-center md:border-r md:border-white/[0.13] md:pr-6 md:text-right"
                >
                  <Circle
                    aria-hidden="true"
                    className="absolute -left-[1.95rem] top-1 size-3 fill-background text-primary md:-right-[0.42rem] md:left-auto md:top-1/2 md:-translate-y-1/2"
                    strokeWidth={2}
                  />
                  <span className="block text-primary">{moment.date}</span>
                  <span className="block">{moment.time}</span>
                </time>

                {mood ? (
                  <span className="inline-flex items-center gap-2 text-sm text-rose-soft">
                    <MoodIcon mood={moment.mood} className="size-4" />
                    {mood.label}
                  </span>
                ) : null}

                <h3 className="font-display text-[1.65rem] leading-tight tracking-[-0.02em] text-primary">
                  {moment.title}
                </h3>

                <p className="max-w-xl text-sm leading-6 text-secondary min-[768px]:max-[899px]:hidden">
                  {moment.excerpt}
                </p>

                <ArrowRight
                  aria-hidden="true"
                  className="hidden size-5 justify-self-end text-secondary md:block"
                />
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
