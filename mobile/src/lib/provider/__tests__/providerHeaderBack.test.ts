import { describe, expect, it } from "vitest";
import { providerHeaderShowsBack } from "../providerHeaderBack";

describe("providerHeaderShowsBack", () => {
  it("shows back only when navigation history exists", () => {
    expect(providerHeaderShowsBack(true)).toBe(true);
    expect(providerHeaderShowsBack(false)).toBe(false);
  });
});