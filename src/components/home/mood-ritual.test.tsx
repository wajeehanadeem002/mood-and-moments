import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MoodRitual } from "./mood-ritual";

describe("MoodRitual", () => {
  function renderRitual() {
    return render(
      <MoodRitual
        isHydrating={false}
        loadError={false}
        onCreateMoment={async () => undefined}
      />,
    );
  }

  it("groups the mood choices under an accessible name", () => {
    renderRitual();

    expect(
      screen.getByRole("group", { name: "Choose a mood" }),
    ).not.toBeNull();
  });

  it("uses the visible submit label as its accessible name", () => {
    renderRitual();

    expect(
      screen.getByRole("button", { name: "Create a Moment" }),
    ).not.toBeNull();
  });

  it("updates the selected mood through an accessible pressed state", () => {
    renderRitual();
    const calm = screen.getByRole("button", { name: "Calm" });

    fireEvent.click(calm);

    expect(calm.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByText("Moments of ease, clarity, and quiet."),
    ).not.toBeNull();
  });

  it("focuses the title and announces validation for an empty moment", () => {
    renderRitual();
    const field = screen.getByLabelText("Moment title");

    fireEvent.click(
      screen.getByRole("button", { name: "Create a Moment" }),
    );

    expect(document.activeElement).toBe(field);
    expect(
      screen.getByText("Give this moment a title."),
    ).not.toBeNull();
  });

  it("exposes required fields before submission", () => {
    renderRitual();

    expect(screen.getByLabelText("Moment title").hasAttribute("required")).toBe(
      true,
    );
    expect(
      screen.getByLabelText("Moment description").hasAttribute("required"),
    ).toBe(true);
    expect(screen.getByLabelText("Moment date").hasAttribute("required")).toBe(
      true,
    );
    expect(
      screen
        .getByLabelText("Add an image (optional)")
        .hasAttribute("required"),
    ).toBe(false);
  });

  it("explains the browser-local persistence scope", () => {
    renderRitual();
    expect(
      screen.getByText("Your moments are saved in this browser."),
    ).not.toBeNull();
  });

  it("lets someone remove an optional image and save a text-only Moment", async () => {
    renderRitual();
    const imageInput = screen.getByLabelText("Add an image (optional)");

    fireEvent.change(imageInput, {
      target: {
        files: [new File(["image"], "memory.gif", { type: "image/gif" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));

    expect(
      screen.queryByText("Choose a JPEG, PNG, or WebP image."),
    ).toBeNull();
    expect(imageInput.getAttribute("aria-invalid")).toBe("false");

    fireEvent.change(screen.getByLabelText("Moment title"), {
      target: { value: "A text-only memory" },
    });
    fireEvent.change(screen.getByLabelText("Moment description"), {
      target: { value: "The image was not needed after all." },
    });
    fireEvent.change(screen.getByLabelText("Moment date"), {
      target: { value: "2026-08-28" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create a Moment" }));

    expect(await screen.findByText("Your moment has been saved.")).not.toBeNull();
  });

  it("ignores a duplicate submission while a save is in progress", async () => {
    let submissionCount = 0;
    let finishSave: (() => void) | undefined;
    const pendingSave = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    render(
      <MoodRitual
        isHydrating={false}
        loadError={false}
        onCreateMoment={async () => {
          submissionCount += 1;
          await pendingSave;
        }}
      />,
    );
    const form = screen.getByRole("form", { name: "Create a Moment" });

    fireEvent.change(screen.getByLabelText("Moment title"), {
      target: { value: "One careful submission" },
    });
    fireEvent.change(screen.getByLabelText("Moment description"), {
      target: { value: "This should only be saved once." },
    });
    fireEvent.change(screen.getByLabelText("Moment date"), {
      target: { value: "2026-08-28" },
    });
    fireEvent.submit(form);
    fireEvent.submit(form);
    const observedSubmissionCount = submissionCount;

    await act(async () => {
      finishSave?.();
      await pendingSave;
    });

    expect(observedSubmissionCount).toBe(1);
  });

  it("announces the in-progress state while a Moment is saving", async () => {
    let finishSave: (() => void) | undefined;
    const pendingSave = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    render(
      <MoodRitual
        isHydrating={false}
        loadError={false}
        onCreateMoment={() => pendingSave}
      />,
    );
    const form = screen.getByRole("form", { name: "Create a Moment" });

    fireEvent.change(screen.getByLabelText("Moment title"), {
      target: { value: "A moment in progress" },
    });
    fireEvent.change(screen.getByLabelText("Moment description"), {
      target: { value: "The save takes a little time." },
    });
    fireEvent.change(screen.getByLabelText("Moment date"), {
      target: { value: "2026-08-28" },
    });
    fireEvent.submit(form);

    expect(form.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Saving your moment…")).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Saving Moment…" })
        .hasAttribute("disabled"),
    ).toBe(true);

    await act(async () => {
      finishSave?.();
      await pendingSave;
    });

    expect(await screen.findByText("Your moment has been saved.")).not.toBeNull();
  });
});
