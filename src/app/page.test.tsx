import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Moment } from "@/data/moments";
import { recentMoments } from "@/data/moments";
import {
  canonicalLegacyMomentValue,
  sha256Text,
} from "@/lib/legacy-moment-import";
import { LEGACY_MOMENTS_STORAGE_KEY } from "@/repositories/local-storage-legacy-moment-source";
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

function momentFromInput(
  input: ApiMomentInput,
  existing?: Moment,
  imageAction: "keep" | "remove" | "replace" = "keep",
): Moment {
  createdMomentCount += existing ? 0 : 1;
  const id =
    existing?.id ??
    `00000000-0000-4000-8000-${String(createdMomentCount).padStart(12, "0")}`;
  const hasImage =
    imageAction === "replace" ||
    (imageAction === "keep" && Boolean(existing?.image));

  return {
    id,
    revision: existing ? Number(existing.revision) + 1 : 1,
    date: formatDate(input.date),
    dateTime: `${input.date}${existing?.dateTime.slice(10) ?? "T09:15:00Z"}`,
    time: existing?.time ?? "9:15 AM",
    mood: input.mood,
    title: input.title,
    excerpt: input.description,
    ...(hasImage
      ? {
          image: {
            src: `/api/moments/${id}/image`,
            alt: `${input.title} moment image.`,
          },
        }
      : {}),
  };
}

function parseMomentBody(body: BodyInit | null | undefined) {
  if (body instanceof FormData) {
    return {
      input: {
        title: String(body.get("title")),
        description: String(body.get("description")),
        mood: String(body.get("mood")) as Moment["mood"],
        date: String(body.get("date")),
      },
      imageAction: (body.get("imageAction") ??
        (body.get("image") ? "replace" : "keep")) as
        | "keep"
        | "remove"
        | "replace",
    };
  }

  return {
    input: JSON.parse(String(body)) as ApiMomentInput,
    imageAction: "keep" as const,
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
        const { imageAction, input } = parseMomentBody(init?.body);
        const moment = momentFromInput(input, undefined, imageAction);
        apiMoments = [moment, ...apiMoments];
        return jsonResponse({ moment }, 201);
      }

      if (url === "/api/moments/import" && method === "POST") {
        const form = init?.body as FormData;
        const importedInput: ApiMomentInput = {
          title: String(form.get("title")),
          description: String(form.get("description")),
          mood: String(form.get("mood")) as Moment["mood"],
          date: String(form.get("date")),
        };
        const sourceId = String(form.get("sourceId"));
        const time = String(form.get("time"));
        const moment = momentFromInput(importedInput, undefined, "keep");
        moment.dateTime = `${importedInput.date}T${time}`;
        moment.time = new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "UTC",
        }).format(new Date(`${importedInput.date}T${time}Z`));
        apiMoments = [moment, ...apiMoments];
        const sourceHash = await sha256Text(
          canonicalLegacyMomentValue({
            sourceId,
            ...importedInput,
            time,
          }),
        );
        return jsonResponse(
          {
            result: {
              outcome: "created",
              imageOutcome: "not_provided",
              sourceId,
              sourceHash,
              moment,
            },
          },
          201,
        );
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
        const { imageAction, input } = parseMomentBody(init?.body);
        const moment = momentFromInput(
          input,
          apiMoments[existingIndex],
          imageAction,
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
        revision: 1,
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

  it("recovers when the first authenticated Moment request arrives before the server session is ready", async () => {
    apiMoments = [
      {
        id: "8e4f4e48-5d8a-42ba-8f8b-5ae3ada4f440",
        revision: 1,
        date: "Aug 30, 2026",
        dateTime: "2026-08-30T18:30:00Z",
        time: "6:30 PM",
        mood: "calm",
        title: "Ready after the session settled",
        excerpt: "The first request was early, but the Moment still loaded.",
      },
    ];
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Authentication is required.",
          },
        },
        401,
      ),
    );

    render(<Home />);

    expect(screen.getByText("Loading your saved moments…")).not.toBeNull();
    await waitForCloudReady();
    expect(
      screen.getAllByText("Ready after the session settled"),
    ).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByText("Your saved moments couldn’t be loaded right now."),
    ).toBeNull();
  });

  it("recovers from a transient 401 with Chrome's receiver-sensitive fetch and can create afterward", async () => {
    apiMoments = [
      {
        id: "c6e3bc70-967c-4be4-ae8d-bf2de4b01d3a",
        revision: 1,
        date: "Aug 30, 2026",
        dateTime: "2026-08-30T19:00:00Z",
        time: "7:00 PM",
        mood: "calm",
        title: "Recovered in the browser",
        excerpt: "The native fetch receiver stayed valid through the retry.",
      },
    ];
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Authentication is required.",
          },
        },
        401,
      ),
    );
    const receiverSensitiveFetch: typeof fetch = function (
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit,
    ) {
      if (this !== undefined && this !== globalThis) {
        return Promise.reject(
          new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation"),
        );
      }

      return fetchMock(input, init);
    };
    vi.stubGlobal("fetch", receiverSensitiveFetch);

    render(<Home />);

    await waitForCloudReady();
    expect(screen.getAllByText("Recovered in the browser")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const form = fillMomentForm();
    fireEvent.click(
      within(form).getByRole("button", { name: "Create a Moment" }),
    );

    expect(await screen.findByText("Your moment has been saved.")).not.toBeNull();
    expect(screen.getAllByText("First rain of the season")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
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

  it("stores a valid image and restores its private proxy after refresh", async () => {
    const firstRender = render(<Home />);
    await waitForCloudReady();
    const form = fillMomentForm();
    const imageInput = within(form).getByLabelText("Add an image (optional)");
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(
      function mockImageRead(this: FileReader) {
        Object.defineProperty(this, "result", {
          configurable: true,
          value: "data:image/png;base64,iVBORw0KGgo=",
        });
        this.dispatchEvent(new ProgressEvent("load"));
      },
    );

    fireEvent.change(imageInput, {
      target: {
        files: [
          new File(
            [
              new Uint8Array([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
              ]),
            ],
            "memory.png",
            { type: "image/png" },
          ),
        ],
      },
    });
    fireEvent.click(
      within(form).getByRole("button", { name: "Create a Moment" }),
    );

    expect(await screen.findByText("Your moment has been saved.")).not.toBeNull();
    expect(
      screen
        .getByRole("img", {
          name: "First rain of the season moment image.",
        })
        .getAttribute("src"),
    ).toMatch(/^\/api\/moments\/.+\/image$/);

    firstRender.unmount();
    render(<Home />);

    expect(
      (await screen.findByRole("img", {
        name: "First rain of the season moment image.",
      })).getAttribute("src"),
    ).toMatch(/^\/api\/moments\/.+\/image$/);
  });

  it("replaces and removes an authenticated image through existing edit controls", async () => {
    const id = "00000000-0000-4000-8000-000000000099";
    apiMoments = [
      {
        id,
        revision: 1,
        date: "Aug 29, 2026",
        dateTime: "2026-08-29T09:15:00Z",
        time: "9:15 AM",
        mood: "calm",
        title: "A cloud image",
        excerpt: "This image can be changed safely.",
        image: {
          src: `/api/moments/${id}/image`,
          alt: "A cloud image moment image.",
        },
      },
    ];
    render(<Home />);
    await waitForCloudReady();
    fireEvent.click(screen.getByRole("button", { name: "Edit A cloud image" }));
    let editForm = screen.getByRole("form", { name: "Edit Moment" });
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(
      function mockImageRead(this: FileReader) {
        Object.defineProperty(this, "result", {
          configurable: true,
          value: "data:image/webp;base64,UklGRgQAAABXRUJQ",
        });
        this.dispatchEvent(new ProgressEvent("load"));
      },
    );
    fireEvent.change(within(editForm).getByLabelText("Add an image (optional)"), {
      target: {
        files: [
          new File(
            [
              new Uint8Array([
                0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45,
                0x42, 0x50,
              ]),
            ],
            "replacement.webp",
            { type: "image/webp" },
          ),
        ],
      },
    });
    fireEvent.click(within(editForm).getByRole("button", { name: "Save Changes" }));

    await within(editForm).findByText("Your moment has been updated.");
    const replacementCall = fetchMock.mock.calls.find(
      ([, init]) =>
        init?.method === "PATCH" &&
        init.body instanceof FormData &&
        init.body.get("imageAction") === "replace",
    );
    expect(replacementCall).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Edit A cloud image" }));
    editForm = screen.getByRole("form", { name: "Edit Moment" });
    fireEvent.click(within(editForm).getByRole("button", { name: "Remove image" }));
    fireEvent.click(within(editForm).getByRole("button", { name: "Save Changes" }));

    await within(editForm).findByText("Your moment has been updated.");
    const removalCall = fetchMock.mock.calls.find(
      ([, init]) =>
        init?.method === "PATCH" &&
        init.body instanceof FormData &&
        init.body.get("imageAction") === "remove",
    );
    expect(removalCall).toBeDefined();
    expect(apiMoments[0]?.image).toBeUndefined();
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

  it("imports a reviewed legacy Moment into both views and reloads it from the cloud API", async () => {
    window.localStorage.setItem(
      LEGACY_MOMENTS_STORAGE_KEY,
      JSON.stringify([
        {
          id: "legacy-rain",
          date: "Aug 21, 2026",
          dateTime: "2026-08-21T17:42:00Z",
          time: "5:42 PM",
          mood: "calm",
          title: "Rain from the old journal",
          excerpt: "A local Moment chosen for cloud import.",
        },
      ]),
    );
    const firstRender = render(<Home />);
    await waitForCloudReady();

    fireEvent.click(
      screen.getByRole("button", { name: "Review legacy Moments" }),
    );
    await screen.findByText("1 ready to import");
    fireEvent.click(screen.getByRole("button", { name: "Import 1 Moment" }));

    expect(
      await screen.findByText("1 imported, 0 failed, 0 skipped."),
    ).not.toBeNull();
    expect(screen.getAllByText("Rain from the old journal")).toHaveLength(3);
    expect(window.localStorage.getItem(LEGACY_MOMENTS_STORAGE_KEY)).not.toBeNull();

    firstRender.unmount();
    render(<Home />);

    expect(
      await screen.findAllByText("Rain from the old journal"),
    ).toHaveLength(2);
  });

  it("keeps the homepage usable when the authenticated API cannot load", async () => {
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

    render(<Home />);

    expect(
      await screen.findByText("Your saved moments couldn’t be loaded right now."),
    ).not.toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps every static example Moment read-only", async () => {
    render(<Home />);

    await waitForCloudReady();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    for (const moment of recentMoments) {
      expect(
        screen.queryByRole("button", { name: `Delete ${moment.title}` }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: `Delete ${moment.title}?` }),
      ).toBeNull();
    }
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
    expect(
      screen.queryByRole("button", { name: "Review legacy Moments" }),
    ).toBeNull();
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
      {
        ...recentMoments[0],
        revision: 1,
        title: "An API collision",
        image: undefined,
      },
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

    await vi.waitFor(() => expect(finishUpdate).toBeTypeOf("function"));
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

  it("preserves an unsaved edit and explicitly loads the latest Moment after a 412", async () => {
    render(<Home />);
    await waitForCloudReady();
    const createForm = fillMomentForm();
    fireEvent.click(
      within(createForm).getByRole("button", { name: "Create a Moment" }),
    );
    await screen.findByText("Your moment has been saved.");
    const existing = apiMoments[0]!;
    fireEvent.click(
      screen.getByRole("button", { name: "Edit First rain of the season" }),
    );
    const editForm = screen.getByRole("form", { name: "Edit Moment" });
    const title = within(editForm).getByLabelText("Moment title");
    fireEvent.change(title, { target: { value: "My unsaved wording" } });
    const currentMoment = {
      ...existing,
      revision: Number(existing.revision) + 1,
      title: "The latest wording from another tab",
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "MOMENT_VERSION_CONFLICT",
            message: "This Moment changed after you loaded it.",
            currentMoment,
          },
        },
        412,
      ),
    );

    fireEvent.click(within(editForm).getByRole("button", { name: "Save Changes" }));

    const conflictAlert = await within(editForm).findByText(
      "This Moment changed in another session. Your draft has not been overwritten.",
    );
    expect(conflictAlert.getAttribute("role")).toBe("alert");
    expect((title as HTMLInputElement).value).toBe("My unsaved wording");
    expect(screen.getAllByText("First rain of the season")).toHaveLength(2);

    fireEvent.click(
      within(editForm).getByRole("button", { name: "Load latest Moment" }),
    );

    expect(
      await screen.findAllByText("The latest wording from another tab"),
    ).toHaveLength(2);
    expect(
      (screen.getByLabelText("Moment title") as HTMLInputElement).value,
    ).toBe("The latest wording from another tab");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByLabelText("Moment title"),
      ),
    );
  });

  it("keeps a stale-delete card visible until the user loads the latest Moment", async () => {
    render(<Home />);
    await waitForCloudReady();
    const createForm = fillMomentForm();
    fireEvent.click(
      within(createForm).getByRole("button", { name: "Create a Moment" }),
    );
    await screen.findByText("Your moment has been saved.");
    const existing = apiMoments[0]!;
    const currentMoment = {
      ...existing,
      revision: Number(existing.revision) + 1,
      title: "Latest Moment before deletion",
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "MOMENT_VERSION_CONFLICT",
            message: "This Moment changed after you loaded it.",
            currentMoment,
          },
        },
        412,
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Delete First rain of the season" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    expect(
      await screen.findByText(
        "This Moment changed in another session. Review the latest version before deleting.",
      ),
    ).not.toBeNull();
    expect(screen.getAllByText("First rain of the season")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Load latest Moment" }));

    expect(await screen.findAllByText("Latest Moment before deletion")).toHaveLength(2);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", {
          name: "Edit Latest Moment before deletion",
        }),
      ),
    );
  });

  it("hides private Moments on sign-out and reloads them after sign-in", async () => {
    apiMoments = [
      {
        id: "4d21afdc-b9f1-4416-b43f-f7fe964b6786",
        revision: 1,
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
