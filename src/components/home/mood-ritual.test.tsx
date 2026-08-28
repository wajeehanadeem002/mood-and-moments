import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Moment } from "@/data/moments";

import { MoodRitual } from "./mood-ritual";

const editableMoment: Moment = {
  id: "editable-moment",
  date: "Aug 28, 2026",
  dateTime: "2026-08-28T09:15:00",
  time: "9:15 AM",
  mood: "calm",
  title: "A quiet morning",
  excerpt: "Sunlight moved slowly across the room.",
  image: {
    src: "data:image/png;base64,aW1hZ2U=",
    alt: "A quiet morning moment image.",
  },
};

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

  it("prefills every editable field when the form enters Edit mode", () => {
    render(
      <MoodRitual
        isHydrating={false}
        loadError={false}
        editingMoment={editableMoment}
        onCreateMoment={async () => undefined}
        onUpdateMoment={async () => undefined}
        onCancelEdit={() => undefined}
      />,
    );

    expect(screen.getByRole("form", { name: "Edit Moment" })).not.toBeNull();
    expect(
      (screen.getByLabelText("Moment title") as HTMLInputElement).value,
    ).toBe("A quiet morning");
    expect(
      (screen.getByLabelText("Moment description") as HTMLTextAreaElement)
        .value,
    ).toBe("Sunlight moved slowly across the room.");
    expect(
      (screen.getByLabelText("Moment date") as HTMLInputElement).value,
    ).toBe("2026-08-28");
    expect(
      screen.getByRole("button", { name: "Calm" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("Current image will be kept.")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Save Changes" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Cancel editing" })).not.toBeNull();
  });


  it("submits an edited Moment through the update callback", async () => {
    let createCount = 0;
    let updateCount = 0;
    let updatedTitle = "";
    let removeImage = true;
    render(
      <MoodRitual
        isHydrating={false}
        loadError={false}
        editingMoment={editableMoment}
        onCreateMoment={async () => {
          createCount += 1;
        }}
        onUpdateMoment={async (draft, options) => {
          updateCount += 1;
          updatedTitle = draft.title;
          removeImage = Boolean(options.removeImage);
        }}
        onCancelEdit={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText("Moment title"), {
      target: { value: "An evening remembered" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(
      await screen.findByText("Your moment has been updated."),
    ).not.toBeNull();
    expect(createCount).toBe(0);
    expect(updateCount).toBe(1);
    expect(updatedTitle).toBe("An evening remembered");
    expect(removeImage).toBe(false);
  });

  it("can remove the existing optional image during an edit", async () => {
    let removeImage = false;
    render(
      <MoodRitual
        isHydrating={false}
        loadError={false}
        editingMoment={editableMoment}
        onCreateMoment={async () => undefined}
        onUpdateMoment={async (_draft, options) => {
          removeImage = Boolean(options.removeImage);
        }}
        onCancelEdit={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));

    expect(screen.queryByText("Current image will be kept.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(
      await screen.findByText("Your moment has been updated."),
    ).not.toBeNull();
    expect(removeImage).toBe(true);
  });

  it("announces an edit-specific loading state and ignores duplicate updates", async () => {
    let updateCount = 0;
    let finishUpdate: (() => void) | undefined;
    const pendingUpdate = new Promise<void>((resolve) => {
      finishUpdate = resolve;
    });
    render(
      <MoodRitual
        isHydrating={false}
        loadError={false}
        editingMoment={editableMoment}
        onCreateMoment={async () => undefined}
        onUpdateMoment={async () => {
          updateCount += 1;
          await pendingUpdate;
        }}
        onCancelEdit={() => undefined}
      />,
    );
    const form = screen.getByRole("form", { name: "Edit Moment" });

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(updateCount).toBe(1);
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Saving your changes…")).not.toBeNull();
    expect(screen.getByLabelText("Moment title").matches(":disabled")).toBe(
      true,
    );
    expect(
      screen.getByRole("button", { name: "Loved" }).matches(":disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Saving Changes…" })
        .hasAttribute("disabled"),
    ).toBe(true);

    await act(async () => {
      finishUpdate?.();
      await pendingUpdate;
    });

    expect(
      await screen.findByText("Your moment has been updated."),
    ).not.toBeNull();
  });

  it("announces an edit-specific storage error without losing the draft", async () => {
    render(
      <MoodRitual
        isHydrating={false}
        loadError={false}
        editingMoment={editableMoment}
        onCreateMoment={async () => undefined}
        onUpdateMoment={async () => {
          throw new DOMException("Storage quota exceeded", "QuotaExceededError");
        }}
        onCancelEdit={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText("Moment title"), {
      target: { value: "A changed draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(
      await screen.findByText(
        "We couldn’t update this moment. Check browser storage and try again.",
      ),
    ).not.toBeNull();
    expect((screen.getByLabelText("Moment title") as HTMLInputElement).value).toBe(
      "A changed draft",
    );
  });
});
