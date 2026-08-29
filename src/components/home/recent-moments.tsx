"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import { ArrowRight, Pencil, Trash2 } from "lucide-react";
import Image from "next/image";

import { MoodIcon } from "@/components/ui/mood-icon";
import { moods, recentMoments, type Moment } from "@/data/moments";

type RecentMomentsProps = {
  moments?: readonly Moment[];
  editableMomentIds?: ReadonlySet<string>;
  isMutationPending?: boolean;
  onEditMoment?: (moment: Moment) => void;
  onDeleteMoment?: (moment: Moment) => Promise<void>;
};

export function RecentMoments({
  moments = recentMoments,
  editableMomentIds = new Set(),
  isMutationPending = false,
  onEditMoment,
  onDeleteMoment,
}: RecentMomentsProps) {
  const [confirmingMomentId, setConfirmingMomentId] = useState<string | null>(
    null,
  );
  const [deletingMomentId, setDeletingMomentId] = useState<string | null>(null);
  const [deleteErrorMomentId, setDeleteErrorMomentId] = useState<
    string | null
  >(null);
  const [deleteSucceeded, setDeleteSucceeded] = useState(false);
  const deleteInProgressRef = useRef(false);
  const confirmDeleteRef = useRef<HTMLButtonElement>(null);
  const deleteStatusRef = useRef<HTMLParagraphElement>(null);
  const deleteButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoreDeleteFocusMomentIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (confirmingMomentId && !deletingMomentId) {
      confirmDeleteRef.current?.focus();
    }
  }, [confirmingMomentId, deletingMomentId]);

  useEffect(() => {
    if (!confirmingMomentId && restoreDeleteFocusMomentIdRef.current) {
      deleteButtonRefs.current
        .get(restoreDeleteFocusMomentIdRef.current)
        ?.focus();
      restoreDeleteFocusMomentIdRef.current = null;
    }
  }, [confirmingMomentId]);

  useEffect(() => {
    if (deleteSucceeded) {
      deleteStatusRef.current?.focus();
    }
  }, [deleteSucceeded]);

  function editMoment(moment: Moment) {
    if (deleteInProgressRef.current || isMutationPending) {
      return;
    }

    setConfirmingMomentId(null);
    setDeleteErrorMomentId(null);
    setDeleteSucceeded(false);
    onEditMoment?.(moment);
  }

  function askToDeleteMoment(momentId: string) {
    if (deleteInProgressRef.current || isMutationPending) {
      return;
    }

    setConfirmingMomentId(momentId);
    setDeleteErrorMomentId(null);
    setDeleteSucceeded(false);
    restoreDeleteFocusMomentIdRef.current = null;
  }

  async function deleteMoment(
    event: FormEvent<HTMLFormElement>,
    moment: Moment,
  ) {
    event.preventDefault();

    if (
      deleteInProgressRef.current ||
      isMutationPending ||
      !onDeleteMoment
    ) {
      return;
    }

    deleteInProgressRef.current = true;
    setDeletingMomentId(moment.id);
    setDeleteErrorMomentId(null);
    setDeleteSucceeded(false);

    try {
      await onDeleteMoment(moment);
      setConfirmingMomentId(null);
      restoreDeleteFocusMomentIdRef.current = null;
      setDeleteSucceeded(true);
    } catch {
      setDeleteErrorMomentId(moment.id);
    } finally {
      deleteInProgressRef.current = false;
      setDeletingMomentId(null);
    }
  }

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

        <p
          ref={deleteStatusRef}
          role="status"
          aria-live="polite"
          tabIndex={-1}
          className={`mb-5 min-h-5 text-sm text-champagne transition-opacity ${
            deleteSucceeded ? "opacity-100" : "sr-only opacity-0"
          }`}
        >
          {deleteSucceeded ? "Moment deleted." : ""}
        </p>

        <div className="border-x border-white/[0.08]">
          {moments.map((moment, index) => {
            const mood = moods.find((item) => item.id === moment.mood);
            const reverse = index % 2 === 1;
            const isEditable = editableMomentIds.has(moment.id);
            const isConfirmingDelete = confirmingMomentId === moment.id;
            const isDeleting = deletingMomentId === moment.id;
            const hasDeleteError = deleteErrorMomentId === moment.id;

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
                      unoptimized={
                        moment.image.src.startsWith("data:") ||
                        moment.image.src.startsWith("/api/moments/")
                      }
                      sizes="(max-width: 639px) calc(100vw - 40px), (max-width: 899px) calc(100vw - 64px), (max-width: 1023px) calc((100vw - 64px) / 2), (max-width: 1439px) calc((100vw - 96px) / 2), 672px"
                      className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.025]"
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_center,rgba(143,67,84,0.12),transparent_62%)] text-rose-soft">
                      <MoodIcon mood={moment.mood} className="size-10" />
                      <span className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary/85">
                        A moment held close
                      </span>
                    </div>
                  )}
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

                  {isEditable && onEditMoment && onDeleteMoment ? (
                    <div className="mt-8 border-t border-white/[0.08] pt-5">
                      {isConfirmingDelete ? (
                        <form
                          role="group"
                          aria-label={`Delete ${moment.title}?`}
                          aria-busy={isDeleting}
                          onSubmit={(event) => deleteMoment(event, moment)}
                          className="rounded-sm border border-rose/25 bg-rose/[0.07] p-4"
                        >
                          <p className="text-sm leading-6 text-primary">
                            Delete this moment? This cannot be undone.
                          </p>
                          <div className="mt-3 flex flex-col gap-2 min-[420px]:flex-row">
                            <button
                              ref={confirmDeleteRef}
                              type="submit"
                              disabled={isDeleting || isMutationPending}
                              className="inline-flex min-h-11 items-center justify-center rounded-sm bg-rose px-4 text-sm font-medium text-white transition hover:bg-rose/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-soft/70 disabled:cursor-wait disabled:opacity-65"
                            >
                              {isDeleting ? "Deleting…" : "Confirm delete"}
                            </button>
                            <button
                              type="button"
                              disabled={isDeleting || isMutationPending}
                              onClick={() => {
                                setConfirmingMomentId(null);
                                setDeleteErrorMomentId(null);
                                restoreDeleteFocusMomentIdRef.current =
                                  moment.id;
                              }}
                              className="inline-flex min-h-11 items-center justify-center rounded-sm border border-white/10 px-4 text-sm font-medium text-secondary transition hover:border-white/20 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lavender/60 disabled:cursor-wait disabled:opacity-65"
                            >
                              Keep moment
                            </button>
                          </div>
                          {hasDeleteError ? (
                            <p
                              role="alert"
                              className="mt-3 text-sm leading-6 text-rose-soft"
                            >
                              We couldn’t delete this moment. Please try again.
                            </p>
                          ) : null}
                        </form>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            disabled={isMutationPending}
                            onClick={() => editMoment(moment)}
                            className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-white/10 px-4 text-sm font-medium text-secondary transition hover:border-lavender/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lavender/60 disabled:cursor-wait disabled:opacity-55"
                            aria-label={`Edit ${moment.title}`}
                          >
                            <Pencil aria-hidden="true" className="size-4" />
                            Edit
                          </button>
                          <button
                            ref={(button) => {
                              if (button) {
                                deleteButtonRefs.current.set(moment.id, button);
                              } else {
                                deleteButtonRefs.current.delete(moment.id);
                              }
                            }}
                            type="button"
                            disabled={isMutationPending}
                            onClick={() => askToDeleteMoment(moment.id)}
                            className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-white/10 px-4 text-sm font-medium text-secondary transition hover:border-rose/45 hover:text-rose-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-soft/70 disabled:cursor-wait disabled:opacity-55"
                            aria-label={`Delete ${moment.title}`}
                          >
                            <Trash2 aria-hidden="true" className="size-4" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <span
                      aria-hidden="true"
                      className="mt-8 inline-flex size-11 items-center justify-center self-end rounded-full border border-white/10 text-primary transition duration-300 group-hover:border-rose/50 group-hover:text-rose-soft"
                    >
                      <ArrowRight aria-hidden="true" className="size-5" />
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
