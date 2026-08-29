import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Moment } from "@/data/moments";
import { recentMoments } from "@/data/moments";
import { MOMENTS_STORAGE_KEY } from "@/repositories/local-storage-moment-repository";
import { setClerkTestAuthState } from "@/test/clerk-test-state";

import Home from "./page";

const pushMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

type ApiMomentInput = {
  title: string;
  description: string;
  mood: Moment["mood"];
  date: string;
};

let apiMoments: Moment[];
let createdMomentCount: number;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

function momentFromInput(input: ApiMomentInput, existing?: Moment): Moment {
  createdMomentCount += existing ? 0 : 1;

  return {
    id:
      existing?.id ??
      `00000000-0000-4000-8000-${String(createdMomentCount).padStart(12, "0")}`,
    date: formatDate(input.date),
    dateTime: `${input.date}${existing?.dateTime.slice(10) ?? "T09:15:00Z"}`,
    time: existing?.time ?? "9:15 AM",
    mood: input.mood,
    title: input.title,
    excerpt: input.description,
  };
}

function installMomentApi() {
  fetchMock.mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/moments" && method === "GET") {
        return jsonResponse({ moments: apiMoments });
      }

      if (url === "/api/moments" && method === "POST") {
        const moment = momentFromInput(
          JSON.parse(String(init?.body)) as ApiMomentInput,
        );
        apiMoments = [moment, ...apiMoments];
        return jsonResponse({ moment }, 201);
      }

      const id = decodeURIComponent(url.replace("/api/moments/", ""));
      const existingIndex = apiMoments.findIndex((moment) => moment.id === id);

      if (existingIndex === -1) {
        return jsonResponse(
          { error: { code: "NOT_FOUND", message: "Moment not found." } },
          404,
        );
      }

      if (method === "PATCH") {
        const moment = momentFromInput(
          JSON.parse(String(init?.body)) as ApiMomentInput,
          apiMoments[existingIndex],
        );
        apiMoments = apiMoments.map((candidate) =>
          candidate.id === id ? moment : candidate,
        );
        return jsonResponse({ moment });
      }

      if (method === "DELETE") {
        apiMoments = apiMoments.filter((moment) => moment.id !== id);
        return new Response(null, { status: 204 });
      }

      return jsonResponse(
        { error: { code: "INTERNAL_ERROR", message: "Unexpected request." } },
        500,
      );
    },
  );
}

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

async function waitForCloudReady() {
  await screen.findByText("Your moments are saved to your account.");
}

describe("Mood & Moments homepage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    apiMoments = [];
    createdMomentCount = 0;
    pushMock.mockReset();
    fetchMock.mockReset();
    installMomentApi();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the complete public experience and loads authenticated Moments", async () => {
    apiMoments = [
      {
        id: "4d21afdc-b9f1-4416-b43f-f7fe964b6786",
        date: "Aug 29, 2026",
        dateTime: "2026-08-29T09:15:00Z",
        time: "9:15 AM",
        mood: "calm",
        title: "A cloud-held memory",
        excerpt: "This belongs to the authenticated account.",
      },
    ];

    render(<Home />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Capture the moments. Feel the memories.",
      }),
    ).not.toBeNull();
    expect(screen.getByText("Loading your saved moments…")).not.toBeNull();
    await waitForCloudReady();
    expect(screen.getAllByText("A cloud-held memory")).toHaveLength(2);
    expect(screen.getAllByRole("article")).toHaveLength(4);
    expect(screen.getByRole("contentinfo")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates a Moment in both views and reloads it from the API after remounting", async () => {
    const existingLocalValue = JSON.stringify([{ legacy: "untouched" }]);
    window.localStorage.setItem(MOMENTS_STORAGE_KEY, existingLocalValue);
    const firstRender = render(<Home />);
    await waitForCloudReady();
    const form = fillMomentForm();

    fireEvent.click(
      within(form).getByRole("button", { name: "Create a Moment" }),
    );

    expect(await screen.findByText("Your moment has been saved.")).not.toBeNull();
    expect(screen.getAllByText("First rain of the season")).toHaveLength(2);
    expect(window.localStorage.getItem(MOMENTS_STORAGE_KEY)).toBe(
      existingLocalValue,
    );
    expect(fetchMock).toHaveBeenLastCalledWith("/api/moments", {
      body: JSON.stringify({
        title: "First rain of the season",
        description: "I opened the window and listened for a while.",
        mood: "calm",
        date: "2026-08-28",
      }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    firstRender.unmount();
    render(<Home />);

    expect(await screen.findAllByText("First rain of the season")).toHaveLength(
      2,
    );
    expect(screen.getAllByRole("article")).toHaveLength(4);
  });

  it("places a backdated API-created Moment chronologically in both views", async () => {
    render(<Home />);
    await waitForCloudReady();
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
    expect(
      within(getSectionByHeading("Recent Moments"))
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([
      "Slow Sunday light",
      "A call worth remembering",
      "Rain against the window",
      "An earlier summer afternoon",
    ]);
    expect(
      within(getSectionByHeading("Memory Timeline"))
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
    await waitForCloudReady();
    const form = screen.getByRole("form", { name: "Create a Moment" });
    const title = within(form).getByLabelText("Moment title");

    fireEvent.click(
      within(form).getByRole("button", { name: "Create a Moment" }),
    );

    expect(within(form).getByText("Give this moment a title.")).not.toBeNull();
    expect(
      within(form).getByText("Describe the moment you want to remember."),
    ).not.toBeNull();
    expect(within(form).getByText("Choose the date of this moment.")).not.toBeNull();
    expect(title.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(title);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsupported image before saving", async () => {
    render(<Home />);
    await waitForCloudReady();
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

  it("does not silently discard a valid image while cloud image storage is deferred", async () => {
    render(<Home />);
    await waitForCloudReady();
    const form = fillMomentForm();
    const imageInput = within(form).getByLabelText("Add an image (optional)");
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(
      function mockImageRead(this: FileReader) {
        Object.defineProperty(this, "result", {
          configurable: true,
          value: "data:image/png;base64,aW1hZ2U=",
        });
        this.dispatchEvent(new ProgressEvent("load"));
      },
    );

    fireEvent.change(imageInput, {
      target: {
        files: [new File(["image"], "memory.png", { type: "image/png" })],
      },
    });
    fireEvent.click(
      within(form).getByRole("button", { name: "Create a Moment" }),
    );

    expect(
      await within(form).findByText(
        "We couldn’t save this moment. Please try again.",
      ),
    ).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Your moment has been saved.")).toBeNull();
  });

  it("reports an API creation error without adding an unsaved Moment", async () => {
    render(<Home />);
    await waitForCloudReady();
    const form = fillMomentForm();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "The Moment service is temporarily unavailable.",
          },
        },
        500,
      ),
    );

    fireEvent.click(
      within(form).getByRole("button", { name: "Create a Moment" }),
    );

    expect(
      await within(form).findByText(
        "We couldn’t save this moment. Please try again.",
      ),
    ).not.toBeNull();
    expect(screen.queryByText("First rain of the season")).toBeNull();
  });

  it("does not read, migrate, or delete existing local Moments", async () => {
    const existingLocalValue = JSON.stringify([
      { id: "private-local-moment", title: "A private local memory" },
    ]);
    window.localStorage.setItem(MOMENTS_STORAGE_KEY, existingLocalValue);
    const storageRead = vi.spyOn(Storage.prototype, "getItem");
    const storageRemove = vi.spyOn(Storage.prototype, "removeItem");

    render(<Home />);

    await waitForCloudReady();
    expect(screen.queryByText("A private local memory")).toBeNull();
    expect(storageRead).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(MOMENTS_STORAGE_KEY)).toBe(
      existingLocalValue,
    );
  });

  it("keeps the homepage usable when the authenticated API cannot load", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: { code: "UNAUTHORIZED", message: "Authentication is required." },
        },
        401,
      ),
    );

    render(<Home />);

    expect(
      await screen.findByText("Your saved moments couldn’t be loaded right now."),
    ).not.toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("keeps every static example Moment read-only", async () => {
    render(<Home />);

    await waitForCloudReady();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
  });

  it("keeps static Moments public and makes no private data calls when signed out", async () => {
    setClerkTestAuthState({ isSignedIn: false, userId: null });
    window.localStorage.setItem(
      MOMENTS_STORAGE_KEY,
      JSON.stringify([{ title: "A private local memory" }]),
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
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storageRead).not.toHaveBeenCalled();
  });

  it("directs signed-out Moment creation to sign-in without API or storage access", async () => {
    setClerkTestAuthState({ isSignedIn: false, userId: null });
    const originalStoredValue = JSON.stringify([{ legacy: "untouched" }]);
    window.localStorage.setItem(MOMENTS_STORAGE_KEY, originalStoredValue);

    render(<Home />);
    await screen.findByText("Sign in to create and keep personal moments.");
    const form = fillMomentForm();

    fireEvent.click(
      within(form).getByRole("button", { name: "Create a Moment" }),
    );

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/sign-in");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(MOMENTS_STORAGE_KEY)).toBe(
      originalStoredValue,
    );
    expect(screen.queryByText("Your moment has been saved.")).toBeNull();
  });

  it("does not duplicate or unlock a static example with a colliding API id", async () => {
    apiMoments = [
      { ...recentMoments[0], title: "An API collision", image: undefined },
    ];

    render(<Home />);

    await waitForCloudReady();
    expect(screen.queryByText("An API collision")).toBeNull();
    expect(screen.getAllByText("Slow Sunday light")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Edit Slow Sunday light" }),
    ).toBeNull();
  });

  it("edits a user-created Moment in both views and reloads the edit from the API", async () => {
    const firstRender = render(<Home />);
    await waitForCloudReady();
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
    expect(screen.getAllByText("Rain, remembered differently")).toHaveLength(2);

    firstRender.unmount();
    render(<Home />);

    expect(
      await screen.findAllByText("Rain, remembered differently"),
    ).toHaveLength(2);
    expect(screen.queryByText("First rain of the season")).toBeNull();
  });

  it("deletes a user-created Moment from both views and keeps it deleted after refresh", async () => {
    const firstRender = render(<Home />);
    await waitForCloudReady();
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
    expect(screen.queryByText("First rain of the season")).toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(3);

    firstRender.unmount();
    render(<Home />);

    await waitForCloudReady();
    expect(screen.queryByText("First rain of the season")).toBeNull();
  });

  it("keeps the previous Moment visible when an API edit fails", async () => {
    render(<Home />);
    await waitForCloudReady();
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
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "The Moment service is temporarily unavailable.",
          },
        },
        500,
      ),
    );

    fireEvent.click(
      within(editForm).getByRole("button", { name: "Save Changes" }),
    );

    expect(
      await within(editForm).findByText(
        "We couldn’t update this moment. Please try again.",
      ),
    ).not.toBeNull();
    expect(screen.getAllByText("First rain of the season")).toHaveLength(2);
    expect(screen.queryByText("An edit that cannot be saved")).toBeNull();
  });

  it("prevents concurrent edit and delete operations while an API update is pending", async () => {
    render(<Home />);
    await waitForCloudReady();
    const createForm = fillMomentForm();
    fireEvent.click(
      within(createForm).getByRole("button", { name: "Create a Moment" }),
    );
    await screen.findByText("Your moment has been saved.");
    fireEvent.click(
      screen.getByRole("button", { name: "Edit First rain of the season" }),
    );
    const editForm = screen.getByRole("form", { name: "Edit Moment" });
    let finishUpdate: ((response: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishUpdate = resolve;
        }),
    );

    fireEvent.click(
      within(editForm).getByRole("button", { name: "Save Changes" }),
    );

    expect(editForm.getAttribute("aria-busy")).toBe("true");
    const deleteButton = screen.getByRole("button", {
      name: "Delete First rain of the season",
    });
    expect(deleteButton.matches(":disabled")).toBe(true);
    fireEvent.click(deleteButton);
    expect(screen.queryByRole("button", { name: "Confirm delete" })).toBeNull();

    finishUpdate?.(jsonResponse({ moment: apiMoments[0] }));
    expect(
      await within(editForm).findByText("Your moment has been updated."),
    ).not.toBeNull();
  });

  it("keeps a Moment visible when API deletion fails", async () => {
    render(<Home />);
    await waitForCloudReady();
    const form = fillMomentForm();
    fireEvent.click(
      within(form).getByRole("button", { name: "Create a Moment" }),
    );
    await screen.findByText("Your moment has been saved.");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "The Moment service is temporarily unavailable.",
          },
        },
        500,
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Delete First rain of the season" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    expect(
      await screen.findByText("We couldn’t delete this moment. Please try again."),
    ).not.toBeNull();
    expect(screen.getAllByText("First rain of the season")).toHaveLength(2);
  });

  it("hides private Moments on sign-out and reloads them after sign-in", async () => {
    apiMoments = [
      {
        id: "4d21afdc-b9f1-4416-b43f-f7fe964b6786",
        date: "Aug 29, 2026",
        dateTime: "2026-08-29T09:15:00Z",
        time: "9:15 AM",
        mood: "loved",
        title: "Only for this account",
        excerpt: "A private cloud Moment.",
      },
    ];
    const view = render(<Home />);
    expect(await screen.findAllByText("Only for this account")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setClerkTestAuthState({ isSignedIn: false, userId: null });
    view.rerender(<Home />);

    expect(
      await screen.findByText("Sign in to create and keep personal moments."),
    ).not.toBeNull();
    expect(screen.queryByText("Only for this account")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setClerkTestAuthState({ isSignedIn: true, userId: "user_test" });
    view.rerender(<Home />);

    expect(await screen.findAllByText("Only for this account")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
