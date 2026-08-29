import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { recentMoments, type Moment } from "@/data/moments";

import { RecentMoments } from "./recent-moments";

const userMoment: Moment = {
  id: "user-moment",
  date: "Aug 28, 2026",
  dateTime: "2026-08-28T09:15:00",
  time: "9:15 AM",
  mood: "calm",
  title: "A quiet morning",
  excerpt: "Sunlight moved slowly across the room.",
};

describe("RecentMoments", () => {
  it("keeps static example Moments completely read-only", () => {
    render(
      <RecentMoments
        moments={recentMoments}
        editableMomentIds={new Set()}
        onEditMoment={vi.fn()}
        onDeleteMoment={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("offers edit and delete actions only for an editable Moment", () => {
    const onEditMoment = vi.fn();
    render(
      <RecentMoments
        moments={[recentMoments[0], userMoment]}
        editableMomentIds={new Set([userMoment.id])}
        onEditMoment={onEditMoment}
        onDeleteMoment={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Edit A quiet morning" }),
    );

    expect(onEditMoment).toHaveBeenCalledOnce();
    expect(onEditMoment).toHaveBeenCalledWith(userMoment);
    expect(
      screen.queryByRole("button", { name: "Edit Slow Sunday light" }),
    ).toBeNull();
  });

  it("disables every card mutation while another Moment mutation is pending", () => {
    render(
      <RecentMoments
        moments={[userMoment]}
        editableMomentIds={new Set([userMoment.id])}
        isMutationPending
        onEditMoment={vi.fn()}
        onDeleteMoment={vi.fn()}
      />,
    );

    expect(
      (
        screen.getByRole("button", {
          name: "Edit A quiet morning",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Delete A quiet morning",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("asks for accessible inline confirmation and supports cancellation", () => {
    const onDeleteMoment = vi.fn();
    render(
      <RecentMoments
        moments={[userMoment]}
        editableMomentIds={new Set([userMoment.id])}
        onEditMoment={vi.fn()}
        onDeleteMoment={onDeleteMoment}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Delete A quiet morning" }),
    );

    expect(
      screen.getByRole("group", { name: "Delete A quiet morning?" }),
    ).not.toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Confirm delete" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Keep moment" }));

    expect(
      screen.queryByRole("group", { name: "Delete A quiet morning?" }),
    ).toBeNull();
    expect(onDeleteMoment).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Delete A quiet morning" }),
    );
  });

  it("announces deletion progress and prevents concurrent submissions", async () => {
    let finishDelete: (() => void) | undefined;
    const pendingDelete = new Promise<void>((resolve) => {
      finishDelete = resolve;
    });
    const onDeleteMoment = vi.fn(() => pendingDelete);
    render(
      <RecentMoments
        moments={[userMoment]}
        editableMomentIds={new Set([userMoment.id])}
        onEditMoment={vi.fn()}
        onDeleteMoment={onDeleteMoment}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete A quiet morning" }),
    );
    const confirmation = screen.getByRole("group", {
      name: "Delete A quiet morning?",
    });
    const confirm = screen.getByRole("button", { name: "Confirm delete" });

    fireEvent.click(confirm);
    fireEvent.submit(confirmation);

    expect(onDeleteMoment).toHaveBeenCalledOnce();
    expect(confirmation.getAttribute("aria-busy")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Deleting…" })
        .hasAttribute("disabled"),
    ).toBe(true);

    await act(async () => {
      finishDelete?.();
      await pendingDelete;
    });

    expect(await screen.findByText("Moment deleted.")).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("status"));
  });

  it("announces a delete error and leaves the Moment available", async () => {
    render(
      <RecentMoments
        moments={[userMoment]}
        editableMomentIds={new Set([userMoment.id])}
        onEditMoment={vi.fn()}
        onDeleteMoment={async () => {
          throw new DOMException("Storage quota exceeded", "QuotaExceededError");
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete A quiet morning" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    expect(
      await screen.findByText(
        "We couldn’t delete this moment. Please try again.",
      ),
    ).not.toBeNull();
    expect(screen.getByText("A quiet morning")).not.toBeNull();
    expect(
      screen.getByRole("group", { name: "Delete A quiet morning?" }),
    ).not.toBeNull();
  });
});
