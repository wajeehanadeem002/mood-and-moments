import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Hero } from "./hero";

describe("Hero", () => {
  it("loads the above-the-fold atmosphere image eagerly", () => {
    const { container } = render(<Hero />);
    const atmosphereImage = container.querySelector("img");

    expect(atmosphereImage?.getAttribute("loading")).toBe("eager");
  });
});
