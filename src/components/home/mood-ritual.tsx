"use client";

import { ChangeEvent, FormEvent, useRef, useState } from "react";

import { MoodIcon } from "@/components/ui/mood-icon";
import { moods, type Moment, type MoodId } from "@/data/moments";
import {
  type MomentDraft,
  type MomentFieldErrors,
  type UpdateMomentOptions,
  validateMomentDraft,
  validateMomentImage,
} from "@/lib/moment-creation";

type Feedback = {
  kind: "error" | "success";
  message: string;
};

type MoodRitualProps = {
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

const accentText: Record<(typeof moods)[number]["accent"], string> = {
  champagne: "text-champagne",
  lavender: "text-lavender",
  rose: "text-rose-soft",
};

const fieldClassName =
  "w-full rounded-sm border border-white/10 bg-background/55 px-4 py-3 text-[0.925rem] leading-6 text-primary outline-none transition placeholder:text-secondary/85 hover:border-white/20 focus:border-rose/65 focus:ring-2 focus:ring-rose/15";

export function MoodRitual({
  isHydrating,
  loadError,
  isMutationPending = false,
  editingMoment = null,
  onCreateMoment,
  onUpdateMoment,
  onCancelEdit,
}: MoodRitualProps) {
  const [selectedMoodId, setSelectedMoodId] = useState<MoodId>(
    editingMoment?.mood ?? "happy",
  );
  const [title, setTitle] = useState(editingMoment?.title ?? "");
  const [description, setDescription] = useState(
    editingMoment?.excerpt ?? "",
  );
  const [date, setDate] = useState(
    editingMoment?.dateTime.slice(0, 10) ?? "",
  );
  const [image, setImage] = useState<File | null>(null);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);
  const [errors, setErrors] = useState<MomentFieldErrors>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInProgressRef = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const selectedMood =
    moods.find((mood) => mood.id === selectedMoodId) ?? moods[0];
  const isEditMode = Boolean(editingMoment);

  function clearFieldError(field: keyof MomentFieldErrors) {
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFeedback(null);
  }

  function selectMood(mood: MoodId) {
    setSelectedMoodId(mood);
    setFeedback(null);
  }

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const selectedImage = event.target.files?.[0] ?? null;
    const imageError = selectedImage
      ? validateMomentImage(selectedImage)
      : null;

    setImage(selectedImage);
    setRemoveExistingImage(false);
    setErrors((current) => {
      const next = { ...current };
      delete next.image;

      if (imageError) {
        next.image = imageError;
      }

      return next;
    });
    setFeedback(null);
  }

  function removeImage() {
    const isRemovingReplacement = Boolean(image);
    setImage(null);
    setRemoveExistingImage(
      !isRemovingReplacement && Boolean(editingMoment?.image),
    );
    clearFieldError("image");

    if (imageRef.current) {
      imageRef.current.value = "";
    }
  }

  async function submitMoment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submissionInProgressRef.current) {
      return;
    }

    const draft: MomentDraft = {
      title,
      description,
      mood: selectedMoodId,
      date,
      image,
    };
    const validationErrors = validateMomentDraft(draft);

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      setFeedback(null);

      if (validationErrors.title) {
        titleRef.current?.focus();
      } else if (validationErrors.description) {
        descriptionRef.current?.focus();
      } else if (validationErrors.date) {
        dateRef.current?.focus();
      } else {
        imageRef.current?.focus();
      }

      return;
    }

    submissionInProgressRef.current = true;
    setIsSubmitting(true);
    setFeedback(null);

    try {
      if (isEditMode) {
        if (!onUpdateMoment) {
          throw new Error("Moment update is not available.");
        }

        await onUpdateMoment(draft, { removeImage: removeExistingImage });
        setFeedback({
          kind: "success",
          message: "Your moment has been updated.",
        });
      } else {
        await onCreateMoment(draft);
        setTitle("");
        setDescription("");
        setDate("");
        setImage(null);
        setErrors({});
        if (imageRef.current) {
          imageRef.current.value = "";
        }
        setFeedback({ kind: "success", message: "Your moment has been saved." });
      }
    } catch {
      setFeedback({
        kind: "error",
        message: isEditMode
          ? "We couldn’t update this moment. Check browser storage and try again."
          : "We couldn’t save this moment. Check browser storage and try again.",
      });
    } finally {
      submissionInProgressRef.current = false;
      setIsSubmitting(false);
    }
  }

  const statusFeedback: Feedback = isSubmitting
    ? {
        kind: "success",
        message: isEditMode ? "Saving your changes…" : "Saving your moment…",
      }
    : (feedback ??
      (loadError
        ? {
            kind: "error",
            message: "Your saved moments couldn’t be loaded in this browser.",
          }
        : {
            kind: "success",
            message: isHydrating
              ? "Loading your saved moments…"
              : "Your moments are saved in this browser.",
          }));

  return (
    <section
      id="moods"
      tabIndex={-1}
      aria-labelledby="mood-ritual-title"
      className="mood-surface relative scroll-mt-28 overflow-hidden rounded-sm border border-white/[0.09] bg-surface/72 p-5 shadow-ritual backdrop-blur-xl sm:p-7 lg:p-8"
    >
      <div className="pointer-events-none absolute inset-x-16 top-0 h-px bg-rose/45" />

      <div className="text-center">
        <p className="eyebrow justify-center">
          {isEditMode ? "Revisit a memory" : "A quiet check-in"}
        </p>
        <h2
          id="mood-ritual-title"
          className="mt-3 font-display text-[clamp(2rem,3.1vw,2.65rem)] leading-none tracking-[-0.025em] text-primary"
        >
          {isEditMode ? "Edit your moment" : "How are you feeling?"}
        </h2>
      </div>

      <form
        aria-label={isEditMode ? "Edit Moment" : "Create a Moment"}
        aria-busy={isSubmitting || isMutationPending}
        className="mt-7"
        noValidate
        onSubmit={submitMoment}
      >
        <fieldset
          disabled={isHydrating || isSubmitting || isMutationPending}
          className="m-0 min-w-0 border-0 p-0"
        >
          <legend className="sr-only">
            {isEditMode ? "Edit Moment details" : "Create a Moment details"}
          </legend>
        <div
          role="group"
          className="grid grid-cols-3 gap-2 sm:grid-cols-6"
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

        <div className="mt-7 grid gap-4 sm:grid-cols-[minmax(0,1.15fr)_minmax(10rem,0.85fr)]">
          <div>
            <label
              htmlFor="moment-title"
              className="block text-sm font-medium text-primary"
            >
              Moment title
            </label>
            <input
              ref={titleRef}
              id="moment-title"
              name="title"
              type="text"
              required
              value={title}
              maxLength={80}
              aria-describedby={errors.title ? "moment-title-error" : undefined}
              aria-invalid={Boolean(errors.title)}
              className={`${fieldClassName} mt-2`}
              placeholder="A name for this memory"
              onChange={(event) => {
                setTitle(event.target.value);
                clearFieldError("title");
              }}
            />
            <p
              id="moment-title-error"
              role={errors.title ? "alert" : undefined}
              className="mt-1.5 min-h-5 text-xs text-rose-soft"
            >
              {errors.title}
            </p>
          </div>

          <div>
            <label
              htmlFor="moment-date"
              className="block text-sm font-medium text-primary"
            >
              Moment date
            </label>
            <input
              ref={dateRef}
              id="moment-date"
              name="date"
              type="date"
              required
              value={date}
              aria-describedby={errors.date ? "moment-date-error" : undefined}
              aria-invalid={Boolean(errors.date)}
              className={`${fieldClassName} mt-2 min-h-12`}
              onChange={(event) => {
                setDate(event.target.value);
                clearFieldError("date");
              }}
            />
            <p
              id="moment-date-error"
              role={errors.date ? "alert" : undefined}
              className="mt-1.5 min-h-5 text-xs text-rose-soft"
            >
              {errors.date}
            </p>
          </div>
        </div>

        <div className="mt-1">
          <label
            htmlFor="moment-description"
            className="block text-sm font-medium text-primary"
          >
            Moment description
          </label>
          <div className="relative mt-2">
            <textarea
              ref={descriptionRef}
              id="moment-description"
              name="description"
              required
              value={description}
              maxLength={280}
              rows={3}
              aria-describedby={`moment-description-count${errors.description ? " moment-description-error" : ""}`}
              aria-invalid={Boolean(errors.description)}
              className={`${fieldClassName} min-h-28 resize-none pr-20`}
              placeholder="What happened, and how did it feel?"
              onChange={(event) => {
                setDescription(event.target.value);
                clearFieldError("description");
              }}
            />
            <span
              id="moment-description-count"
              className="pointer-events-none absolute bottom-3 right-3 text-[0.68rem] tabular-nums text-secondary/85"
            >
              {description.length} / 280
            </span>
          </div>
          <p
            id="moment-description-error"
            role={errors.description ? "alert" : undefined}
            className="mt-1.5 min-h-5 text-xs text-rose-soft"
          >
            {errors.description}
          </p>
        </div>

        <div className="mt-1">
          <label
            htmlFor="moment-image"
            className="block text-sm font-medium text-primary"
          >
            Add an image (optional)
          </label>
          <input
            ref={imageRef}
            id="moment-image"
            name="image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-describedby={`moment-image-help${errors.image ? " moment-image-error" : ""}`}
            aria-invalid={Boolean(errors.image)}
            className="mt-2 block min-h-12 w-full cursor-pointer rounded-sm border border-white/10 bg-background/55 text-sm text-secondary file:mr-4 file:min-h-12 file:border-0 file:border-r file:border-white/10 file:bg-white/[0.04] file:px-4 file:text-sm file:font-medium file:text-primary hover:border-white/20"
            onChange={selectImage}
          />
          <div className="mt-1.5 flex min-h-5 flex-wrap items-center justify-between gap-2 text-xs">
            <p id="moment-image-help" className="text-secondary/85">
              {isEditMode && editingMoment?.image && !image
                ? removeExistingImage
                  ? "No image will be saved."
                  : "Current image will be kept."
                : "JPEG, PNG, or WebP · 1 MB maximum"}
            </p>
            {image || (editingMoment?.image && !removeExistingImage) ? (
              <button
                type="button"
                disabled={isSubmitting}
                className="inline-flex min-h-11 items-center rounded-sm px-2 font-medium text-champagne transition-colors hover:text-primary focus-visible:outline-none disabled:cursor-wait disabled:opacity-65"
                onClick={removeImage}
              >
                Remove image
              </button>
            ) : null}
            <p
              id="moment-image-error"
              role={errors.image ? "alert" : undefined}
              className="text-rose-soft"
            >
              {errors.image}
            </p>
          </div>
        </div>

        <div className="mt-3 min-h-6 text-center">
          <p
            id="moment-feedback"
            role={statusFeedback.kind === "error" ? "alert" : "status"}
            className={`text-sm ${statusFeedback.kind === "error" ? "text-rose-soft" : "text-champagne"}`}
          >
            {statusFeedback.message}
          </p>
        </div>

        <div className="mt-4 flex flex-col justify-center gap-3 sm:flex-row">
          <button
            type="submit"
            disabled={isHydrating || isSubmitting}
            className="button-primary flex min-h-12 w-full items-center justify-center px-7 text-sm font-medium disabled:cursor-wait disabled:opacity-65 sm:w-auto"
          >
            {isSubmitting
              ? isEditMode
                ? "Saving Changes…"
                : "Saving Moment…"
              : isEditMode
                ? "Save Changes"
                : "Create a Moment"}
          </button>
          {isEditMode ? (
            <button
              type="button"
              disabled={isSubmitting}
              className="button-secondary flex min-h-12 w-full items-center justify-center px-7 text-sm font-medium disabled:cursor-wait disabled:opacity-65 sm:w-auto"
              onClick={onCancelEdit}
            >
              Cancel editing
            </button>
          ) : null}
        </div>
        </fieldset>
      </form>
    </section>
  );
}
