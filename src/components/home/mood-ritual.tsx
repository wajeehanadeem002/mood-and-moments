"use client";

import { FormEvent, useRef, useState } from "react";

import { MoodIcon } from "@/components/ui/mood-icon";
import { moods, type MoodId } from "@/data/moments";
import {
  createMomentConfirmation,
  validateMomentText,
} from "@/lib/mood-ritual";

type Feedback = {
  kind: "error" | "success";
  message: string;
};

const accentText: Record<(typeof moods)[number]["accent"], string> = {
  champagne: "text-champagne",
  lavender: "text-lavender",
  rose: "text-rose-soft",
};

export function MoodRitual() {
  const [selectedMoodId, setSelectedMoodId] = useState<MoodId>("happy");
  const [momentText, setMomentText] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectedMood =
    moods.find((mood) => mood.id === selectedMoodId) ?? moods[0];

  function selectMood(mood: MoodId) {
    setSelectedMoodId(mood);
    if (feedback) {
      setFeedback(null);
    }
  }

  function submitMoment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationMessage = validateMomentText(momentText);

    if (validationMessage) {
      setFeedback({ kind: "error", message: validationMessage });
      textareaRef.current?.focus();
      return;
    }

    setFeedback({
      kind: "success",
      message: createMomentConfirmation(selectedMood.label),
    });
  }

  return (
    <section
      id="moods"
      tabIndex={-1}
      aria-labelledby="mood-ritual-title"
      className="mood-surface relative scroll-mt-28 overflow-hidden rounded-sm border border-white/[0.09] bg-surface/72 p-5 shadow-ritual backdrop-blur-xl sm:p-7 lg:p-8"
    >
      <div className="pointer-events-none absolute inset-x-16 top-0 h-px bg-rose/45" />

      <div className="text-center">
        <p className="eyebrow justify-center">A quiet check-in</p>
        <h2
          id="mood-ritual-title"
          className="mt-3 font-display text-[clamp(2rem,3.1vw,2.65rem)] leading-none tracking-[-0.025em] text-primary"
        >
          How are you feeling?
        </h2>
      </div>

      <div
        role="group"
        className="mt-7 grid grid-cols-3 gap-2 sm:grid-cols-6"
        aria-label="Choose a mood"
      >
        {moods.map((mood) => {
          const isSelected = selectedMood.id === mood.id;

          return (
            <button
              key={mood.id}
              type="button"
              aria-pressed={isSelected}
              data-selected={isSelected ? "true" : "false"}
              data-accent={mood.accent}
              className="mood-choice group flex min-h-[5.75rem] flex-col items-center justify-center gap-2 rounded-sm border border-white/10 bg-white/[0.025] px-2 py-3 text-secondary transition duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.045] hover:text-primary focus-visible:outline-none sm:min-h-[6.25rem]"
              onClick={() => selectMood(mood.id)}
            >
              <MoodIcon
                mood={mood.id}
                className={`size-6 transition-transform duration-300 group-hover:scale-105 sm:size-7 ${accentText[mood.accent]}`}
              />
              <span className="text-xs font-medium sm:text-[0.8rem]">
                {mood.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-7 text-center" aria-live="polite">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-secondary/80">
          You selected
        </p>
        <div
          className={`mt-2 flex items-center justify-center gap-2 ${accentText[selectedMood.accent]}`}
        >
          <MoodIcon mood={selectedMood.id} className="size-7" />
          <p className="font-display text-3xl leading-none tracking-[-0.02em]">
            {selectedMood.label}
          </p>
        </div>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-secondary">
          {selectedMood.description}
        </p>
      </div>

      <form className="mt-7" noValidate onSubmit={submitMoment}>
        <label
          htmlFor="moment-note"
          className="block text-sm font-medium text-primary"
        >
          What is one moment that made you feel this way?
        </label>
        <div className="relative mt-3">
          <textarea
            ref={textareaRef}
            id="moment-note"
            name="moment"
            value={momentText}
            maxLength={120}
            rows={3}
            aria-describedby="moment-count moment-feedback"
            aria-invalid={feedback?.kind === "error"}
            className="min-h-28 w-full resize-none rounded-sm border border-white/10 bg-background/55 px-4 py-3.5 pr-16 text-[0.925rem] leading-6 text-primary outline-none transition placeholder:text-secondary/85 hover:border-white/20 focus:border-rose/65 focus:ring-2 focus:ring-rose/15"
            placeholder="A small kindness, a familiar song, rain on the glass…"
            onChange={(event) => {
              setMomentText(event.target.value);
              if (feedback) {
                setFeedback(null);
              }
            }}
          />
          <span
            id="moment-count"
            className="pointer-events-none absolute bottom-3 right-3 text-[0.68rem] tabular-nums text-secondary/85"
          >
            {momentText.length} / 120
          </span>
        </div>

        <div className="mt-3 min-h-6 text-center">
          <p
            id="moment-feedback"
            role={feedback?.kind === "error" ? "alert" : "status"}
            className={`text-sm ${
              feedback?.kind === "error" ? "text-rose-soft" : "text-champagne"
            }`}
          >
            {feedback?.message ?? "This moment stays in your current preview."}
          </p>
        </div>

        <button
          type="submit"
          className="button-primary mx-auto mt-4 flex min-h-12 w-full items-center justify-center px-7 text-sm font-medium sm:w-auto"
        >
          Create a Moment
        </button>
      </form>
    </section>
  );
}
