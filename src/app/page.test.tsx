import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recentMoments } from "@/data/moments";
import { MOMENTS_STORAGE_KEY } from "@/repositories/local-storage-moment-repository";
import { setClerkTestAuthState } from "@/test/clerk-test-state";

import Home from "./page";

const pushMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

function fillMomentForm() {
  const form = screen.getByRole("form", { name: "Create a Moment" });

  fireEvent.change(within(form).getByLabelText("Moment title"), {
    target: { value: "First rain of the season" },
  });
  fireEvent.change(within(form).getByLabelText("Moment description"), {
    target: { value: "I opened the window and listened for a while." },
  });
  fireEvent.change(within(form).getByLabelText("Moment date"), {
    target: { value: "2026-08-28" },
  });
  fireEvent.click(within(form).getByRole("button", { name: "Calm" }));

  return form;
}

function getSectionByHeading(name: string): HTMLElement {
  const section = screen.getByRole("heading", { name }).closest("section");

  if (!section) {
    throw new Error(`Could not find the ${name} section.`);
  }

  return section;
}

describe("Mood & Moments homepage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    pushMock.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders the complete single-page experience with semantic landmarks", async () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Capture the moments. Feel the memories.",
      }),
    ).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "Recent Moments" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "Memory Timeline" }),
    ).not.toBeNull();
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(3));
    expect(screen.getByRole("contentinfo")).not.toBeNull();
  });

  it("loads saved Moments without hiding the static examples", async () => {
    render(<Home />);

    expect(screen.getByText("Loading your saved moments…")).not.toBeNull();
    expect(
      await screen.findByText("Your moments are saved in this browser."),
    ).not.toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("creates a Moment in both views and restores it after remounting", async () => {
    const firstRender = render(<Home />);
    await screen.findByText("Your moments are saved in this browser.");
    const form = fillMomentForm();

    fireEvent.click(
      within(form).getByRole("button", { name: "Create a Moment" }),
    );

    expect(await screen.findByText("Your moment has been saved.")).not.toBeNull();
    expect(screen.getAllByText("First rain of the season")).toHaveLength(2);
    expect(window.localStorage.getItem(MOMENTS_STORAGE_KEY)).toContain(
      "First rain of the season",
    );

    firstRender.unmount();
    render(<Home />);

    expect(await screen.findAllByText("First rain of the season")).toHaveLength(
      2,
    );
    expect(screen.getAllByRole("article")).toHaveLength(4);
  });

  it("places a backdated Moment chronologically in both views", async () => {
    render(<Home />);
    await screen.findByText("Your moments are saved in this browser.");
    const form = screen.getByRole("form", { name: "Create a Moment" });

    fireEvent.change(within(form).getByLabelText("Moment title"), {
      target: { value: "An earlier summer afternoon" },
    });
    fireEvent.change(within(form).getByLabelText("Moment description"), {
      target: { value: "A memory from before the existing examples." },
    });
    fireEvent.change(within(form).getByLabelText("Moment date"), {
      target: { value: "2026-08-20" },
    });
    fireEvent.click(
      within(form).getByRole("button", { name: "Create a Moment" }),
    );

    await screen.findByText("Your moment has been saved.");
    const recentSection = screen
      .getByRole("heading", { name: "Recent Moments" })
      .closest("section");
    const timelineSection = screen
      .getByRole("heading", { name: "Memory Timeline" })
      .closest("section");

    expect(
      within(recentSection as HTMLElement)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([
      "Slow Sunday light",
      "A call worth remembering",
      "Rain against the window",
      "An earlier summer afternoon",
    ]);
    expect(
      within(timelineSection as HTMLElement)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([
      "Slow Sunday light",
      "A call worth remembering",
      "Rain against the window",
      "Needed a slower morning",
      "Walked by the river",
      "An earlier summer afternoon",
    ]);
  });

  it("shows accessible required-field errors and focuses the first field", async () => {
    render(<Home />);
    await screen.findByText("Your moments are saved in this browser.");
    const form = screen.getByRole("form", { name: "Create a Moment" });
    const title = within(form).getByLabelText("Moment title");

    fireEvent.click(
      within(form).getByRole("button", { name: "Create a Moment" }),
    );

    expect(within(form).getByText("Give this moment a title.")).not.toBeNull();
    expect(
      within(form).getByText("Describe the moment you want to remember."),
    ).not.toBeNull();
    expect(
      within(form).getByText("Choose the date of this moment."),
    ).not.toBeNull();
    expect(title.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(title);
  });

  it("rejects an unsupported image before saving", async () => {
    render(<Home />);
    await screen.findByText("Your moments are saved in this browser.");
    const form = screen.getByRole("form", { name: "Create a Moment" });
    const imageInput = within(form).getByLabelText("Add an image (optional)");

    fireEvent.change(imageInput, {
      target: {
        files: [new File(["image"], "memory.gif", { type: "image/gif" })],
      },
    });

    expect(
      within(form).getByText("Choose a JPEG, PNG, or WebP image."),
    ).not.toBeNull();
    expect(imageInput.getAttribute("aria-invalid")).toBe("true");
  });

  it("announces a storage error without adding an unsaved Moment", async () => {
    render(<Home />);
    await screen.findByText("Your moments are saved in this browser.");
    const form = fillMomentForm();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    });

    fireEvent.click(
      within(form).getByRole("button", { name: "Create a Moment" }),
    );

    expect(
      await within(form).findByText(
        "We couldn’t save this moment. Check browser storage and try again.",
      ),
    ).not.toBeNull();
    expect(screen.queryByText("First rain of the season")).toBeNull();
  });

  it("ignores corrupted saved data and keeps the homepage usable", async () => {
    window.localStorage.setItem(MOMENTS_STORAGE_KEY, "{not-json");

    render(<Home />);

    expect(
      await screen.findByText("Your moments are saved in this browser."),
    ).not.toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(window.localStorage.getItem(MOMENTS_STORAGE_KEY)).toBeNull();
  });

  it("keeps the homepage usable when browser storage access is blocked", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage access denied", "SecurityError");
    });

    render(<Home />);

    expect(
      await screen.findByText(
        "Your saved moments couldn’t be loaded in this browser.",
      ),
    ).not.toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("keeps every static example Moment read-only", async () => {
    render(<Home />);

    await screen.findByText("Your moments are saved in this browser.");

    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
  });

  it("keeps static Moments public and local Moments private when signed out", async () => {
    setClerkTestAuthState({ isSignedIn: false, userId: null });
    window.localStorage.setItem(
      MOMENTS_STORAGE_KEY,
      JSON.stringify([
        {
          id: "private-local-moment",
          date: "Aug 28, 2026",
          dateTime: "2026-08-28T09:00:00+05:00",
          time: "9:00 AM",
          mood: "calm",
          title: "A private local memory",
          excerpt: "This should only appear after authentication.",
        },
      ]),
    );
    const storageRead = vi.spyOn(Storage.prototype, "getItem");

    render(<Home />);

    expect(
      await screen.findByText("Sign in to create and keep personal moments."),
    ).not.toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getAllByText("Slow Sunday light")).toHaveLength(2);
    expect(screen.queryByText("A private local memory")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
    expect(storageRead).not.toHaveBeenCalled();
  });

  it("directs signed-out Moment creation to sign-in without changing storage", async () => {
    setClerkTestAuthState({ isSignedIn: false, userId: null });
    const originalStoredValue = JSON.stringify([]);
    window.localStorage.setItem(MOMENTS_STORAGE_KEY, originalStoredValue);

    render(<Home />);
    await screen.findByText("Sign in to create and keep personal moments.");
    const form = fillMomentForm();

    fireEvent.click(
      within(form).getByRole("button", { name: "Create a Moment" }),
    );

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/sign-in");
    expect(window.localStorage.getItem(MOMENTS_STORAGE_KEY)).toBe(
      originalStoredValue,
    );
    expect(screen.queryByText("Your moment has been saved.")).toBeNull();
    expect(screen.queryByText("First rain of the season")).toBeNull();
  });

  it("does not duplicate or unlock a static example with a colliding stored id", async () => {
    window.localStorage.setItem(
      MOMENTS_STORAGE_KEY,
      JSON.stringify([
        {
          ...recentMoments[0],
          title: "A stored collision",
          image: undefined,
        },
      ]),
    );

    render(<Home />);

    await screen.findByText("Your moments are saved in this browser.");
    expect(screen.queryByText("A stored collision")).toBeNull();
    expect(screen.getAllByText("Slow Sunday light")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Edit Slow Sunday light" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Delete Slow Sunday light" }),
    ).toBeNull();
  });

  it("edits a user-created Moment in both views and persists it after refresh", async () => {
    const firstRender = render(<Home />);
    await screen.findByText("Your moments are saved in this browser.");
    const createForm = fillMomentForm();
    fireEvent.click(
      within(createForm).getByRole("button", { name: "Create a Moment" }),
    );
    await screen.findByText("Your moment has been saved.");

    fireEvent.click(
      screen.getByRole("button", { name: "Edit First rain of the season" }),
    );
    const firstEditForm = screen.getByRole("form", { name: "Edit Moment" });
    expect(
      (within(firstEditForm).getByLabelText("Moment title") as HTMLInputElement)
        .value,
    ).toBe("First rain of the season");

    fireEvent.click(
      within(firstEditForm).getByRole("button", { name: "Cancel editing" }),
    );
    expect(screen.getByRole("form", { name: "Create a Moment" })).not.toBeNull();
    expect(screen.getAllByText("First rain of the season")).toHaveLength(2);

    fireEvent.click(
      screen.getByRole("button", { name: "Edit First rain of the season" }),
    );
    const editForm = screen.getByRole("form", { name: "Edit Moment" });
    fireEvent.change(within(editForm).getByLabelText("Moment title"), {
      target: { value: "Rain, remembered differently" },
    });
    fireEvent.change(within(editForm).getByLabelText("Moment description"), {
      target: { value: "I noticed how peaceful the room became." },
    });
    fireEvent.change(within(editForm).getByLabelText("Moment date"), {
      target: { value: "2026-08-25" },
    });
    fireEvent.click(within(editForm).getByRole("button", { name: "Loved" }));
    fireEvent.click(
      within(editForm).getByRole("button", { name: "Save Changes" }),
    );

    expect(
      await within(editForm).findByText("Your moment has been updated."),
    ).not.toBeNull();
    expect(screen.queryByText("First rain of the season")).toBeNull();
    expect(
      within(getSectionByHeading("Recent Moments")).getByText(
        "Rain, remembered differently",
      ),
    ).not.toBeNull();
    expect(
      within(getSectionByHeading("Memory Timeline")).getByText(
        "Rain, remembered differently",
      ),
    ).not.toBeNull();
    expect(window.localStorage.getItem(MOMENTS_STORAGE_KEY)).toContain(
      "Rain, remembered differently",
    );
    expect(window.localStorage.getItem(MOMENTS_STORAGE_KEY)).not.toContain(
      "First rain of the season",
    );
    expect(screen.getAllByText("Slow Sunday light")).toHaveLength(2);

    firstRender.unmount();
    render(<Home />);

    await screen.findByText("Your moments are saved in this browser.");
    expect(
      within(getSectionByHeading("Recent Moments")).getByText(
        "Rain, remembered differently",
      ),
    ).not.toBeNull();
    expect(
      within(getSectionByHeading("Memory Timeline")).getByText(
        "Rain, remembered differently",
      ),
    ).not.toBeNull();
    expect(
      within(getSectionByHeading("Recent Moments")).queryByText(
        "First rain of the season",
      ),
    ).toBeNull();
    expect(
      within(getSectionByHeading("Memory Timeline")).queryByText(
        "First rain of the season",
      ),
    ).toBeNull();
  });

  it("deletes a user-created Moment from both views and keeps it deleted after refresh", async () => {
    const firstRender = render(<Home />);
    await screen.findByText("Your moments are saved in this browser.");
    const form = fillMomentForm();
    fireEvent.click(
      within(form).getByRole("button", { name: "Create a Moment" }),
    );
    await screen.findByText("Your moment has been saved.");

    fireEvent.click(
      screen.getByRole("button", { name: "Delete First rain of the season" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    expect(await screen.findByText("Moment deleted.")).not.toBeNull();
    expect(
      within(getSectionByHeading("Recent Moments")).queryByText(
        "First rain of the season",
      ),
    ).toBeNull();
    expect(
      within(getSectionByHeading("Memory Timeline")).queryByText(
        "First rain of the season",
      ),
    ).toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(window.localStorage.getItem(MOMENTS_STORAGE_KEY)).not.toContain(
      "First rain of the season",
    );
    expect(screen.getAllByText("Slow Sunday light")).toHaveLength(2);

    firstRender.unmount();
    render(<Home />);

    await screen.findByText("Your moments are saved in this browser.");
    expect(screen.queryByText("First rain of the season")).toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("keeps the previous Moment visible when an edit cannot be persisted", async () => {
    render(<Home />);
    await screen.findByText("Your moments are saved in this browser.");
    const createForm = fillMomentForm();
    fireEvent.click(
      within(createForm).getByRole("button", { name: "Create a Moment" }),
    );
    await screen.findByText("Your moment has been saved.");
    fireEvent.click(
      screen.getByRole("button", { name: "Edit First rain of the season" }),
    );
    const editForm = screen.getByRole("form", { name: "Edit Moment" });
    fireEvent.change(within(editForm).getByLabelText("Moment title"), {
      target: { value: "An edit that cannot be saved" },
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    });

    fireEvent.click(
      within(editForm).getByRole("button", { name: "Save Changes" }),
    );

    expect(
      await within(editForm).findByText(
        "We couldn’t update this moment. Check browser storage and try again.",
      ),
    ).not.toBeNull();
    expect(screen.getAllByText("First rain of the season")).toHaveLength(2);
    expect(screen.queryByText("An edit that cannot be saved")).toBeNull();
    expect(window.localStorage.getItem(MOMENTS_STORAGE_KEY)).toContain(
      "First rain of the season",
    );
  });

  it("locks form and card mutations while an image edit is being persisted", async () => {
    render(<Home />);
    await screen.findByText("Your moments are saved in this browser.");
    const createForm = fillMomentForm();
    fireEvent.click(
      within(createForm).getByRole("button", { name: "Create a Moment" }),
    );
    await screen.findByText("Your moment has been saved.");
    fireEvent.click(
      screen.getByRole("button", { name: "Edit First rain of the season" }),
    );
    const editForm = screen.getByRole("form", { name: "Edit Moment" });
    fireEvent.change(within(editForm).getByLabelText("Add an image (optional)"), {
      target: {
        files: [new File(["image"], "rain.png", { type: "image/png" })],
      },
    });
    let finishImageRead: (() => void) | undefined;
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(
      function mockImageRead(this: FileReader) {
        finishImageRead = () => {
          Object.defineProperty(this, "result", {
            configurable: true,
            value: "data:image/png;base64,aW1hZ2U=",
          });
          this.dispatchEvent(new ProgressEvent("load"));
        };
      },
    );

    fireEvent.click(
      within(editForm).getByRole("button", { name: "Save Changes" }),
    );

    expect(editForm.getAttribute("aria-busy")).toBe("true");
    expect(
      within(editForm).getByLabelText("Moment title").matches(":disabled"),
    ).toBe(true);
    const deleteButton = screen.getByRole("button", {
      name: "Delete First rain of the season",
    });
    expect(deleteButton.matches(":disabled")).toBe(true);
    fireEvent.click(deleteButton);
    expect(screen.queryByRole("button", { name: "Confirm delete" })).toBeNull();

    await act(async () => {
      finishImageRead?.();
      await Promise.resolve();
    });

    expect(
      await within(editForm).findByText("Your moment has been updated."),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Delete First rain of the season" })
        .matches(":disabled"),
    ).toBe(false);
  });

  it("keeps a Moment visible when deletion cannot be persisted", async () => {
    render(<Home />);
    await screen.findByText("Your moments are saved in this browser.");
    const form = fillMomentForm();
    fireEvent.click(
      within(form).getByRole("button", { name: "Create a Moment" }),
    );
    await screen.findByText("Your moment has been saved.");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Delete First rain of the season" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    expect(
      await screen.findByText(
        "We couldn’t delete this moment. Check browser storage and try again.",
      ),
    ).not.toBeNull();
    expect(screen.getAllByText("First rain of the season")).toHaveLength(2);
    expect(window.localStorage.getItem(MOMENTS_STORAGE_KEY)).toContain(
      "First rain of the season",
    );
  });
});
