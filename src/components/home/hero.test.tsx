import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Hero } from "./hero";

describe("Hero", () => {
  it("loads the above-the-fold atmosphere image eagerly", () => {
    const { container } = render(
      <Hero
        isHydrating={false}
        loadError={false}
        onCreateMoment={async () => undefined}
      />,
    );
    const atmosphereImage = container.querySelector("img");

    expect(atmosphereImage?.getAttribute("loading")).toBe("eager");
  });

  it("routes the signed-out Create a Moment action through authentication", () => {
    const onRequireAuthentication = vi.fn();

    render(
      <Hero
        isHydrating={false}
        loadError={false}
        isAuthenticated={false}
        onCreateMoment={async () => undefined}
        onRequireAuthentication={onRequireAuthentication}
      />,
    );

    const createMomentLink = screen.getByRole("link", {
      name: "Create a Moment",
    });

    expect(createMomentLink.getAttribute("href")).toBe("/sign-in");

    fireEvent.click(createMomentLink);

    expect(onRequireAuthentication).toHaveBeenCalledOnce();
  });
});
