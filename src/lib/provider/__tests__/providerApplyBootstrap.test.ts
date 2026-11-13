import { describe, expect, it } from "vitest";
import { providerApplyBootstrapLoading } from "../providerApplyBootstrap";

describe("providerApplyBootstrapLoading", () => {
  it("blocks only when a bootstrap query is not yet successful", () => {
    expect(providerApplyBootstrapLoading([{ isSuccess: true }, { isSuccess: true }])).toBe(false);
    expect(providerApplyBootstrapLoading([{ isSuccess: true }, { isSuccess: false }])).toBe(true);
  });
});
