import Image from "next/image";

import { MoodRitual } from "@/components/home/mood-ritual";
import type { Moment } from "@/data/moments";
import type {
  MomentDraft,
  UpdateMomentOptions,
} from "@/lib/moment-creation";

type HeroProps = {
  isHydrating: boolean;
  loadError: boolean;
  isMutationPending?: boolean;
  editingMoment?: Moment | null;
  onCreateMoment: (draft: MomentDraft) => Promise<void>;
  onUpdateMoment?: (
    draft: MomentDraft,
    options: UpdateMomentOptions,
  ) => Promise<void>;
  onCancelEdit?: () => void;
};

export function Hero({
  isHydrating,
  loadError,
  isMutationPending = false,
  editingMoment = null,
  onCreateMoment,
  onUpdateMoment,
  onCancelEdit,
}: HeroProps) {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate overflow-hidden border-b border-white/[0.06]"
    >
      <Image
        src="/images/atmosphere/botanical-dusk.png"
        alt=""
        fill
        loading="eager"
        sizes="100vw"
        className="-z-20 object-cover object-left opacity-25"
      />
      <div className="absolute inset-0 -z-10 bg-background/76" />

      <div className="mx-auto grid w-full max-w-[1440px] items-center gap-12 px-5 py-16 sm:px-8 sm:py-20 min-[900px]:grid-cols-[0.95fr_1.05fr] min-[900px]:gap-16 min-[900px]:py-24 lg:px-12 xl:gap-24 xl:py-28">
        <div className="max-w-2xl">
          <p className="eyebrow">A home for what matters</p>
          <h1
            id="hero-title"
            className="mt-6 max-w-[12ch] font-display text-[clamp(3.75rem,7.3vw,7.4rem)] leading-[0.86] tracking-[-0.052em] text-primary"
          >
            Capture the moments. Feel the memories.
          </h1>
          <p className="mt-8 max-w-[36rem] text-base leading-8 text-secondary sm:text-lg">
            A quiet place to notice how you feel, hold onto what matters,
            and return to the moments that made you.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href="#moods"
              className="button-primary inline-flex min-h-12 items-center justify-center px-7 text-sm font-medium"
            >
              Create a Moment
            </a>
            <a
              href="#moments"
              className="button-secondary inline-flex min-h-12 items-center justify-center px-7 text-sm font-medium"
            >
              Explore Moments
            </a>
          </div>

          <p className="mt-9 max-w-md border-l border-champagne/35 pl-4 text-sm italic leading-6 text-secondary/85">
            There is no right way to feel. Begin with what is true right
            now.
          </p>
        </div>

        <MoodRitual
          key={editingMoment?.id ?? "create"}
          isHydrating={isHydrating}
          loadError={loadError}
          isMutationPending={isMutationPending}
          editingMoment={editingMoment}
          onCreateMoment={onCreateMoment}
          onUpdateMoment={onUpdateMoment}
          onCancelEdit={onCancelEdit}
        />
      </div>
    </section>
  );
}
