import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOMENTS_STORAGE_KEY } from "@/repositories/local-storage-moment-repository";

import Home from "./page";

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

describe("Mood & Moments homepage", () => {
  beforeEach(() => window.localStorage.clear());
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
});
