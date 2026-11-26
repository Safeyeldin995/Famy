import { describe, expect, it } from "vitest";
import { customerRebookParams, shouldShowCustomerRebook } from "../customerRebook";

describe("shouldShowCustomerRebook", () => {
  it("allows completed and cancelled only", () => {
    expect(shouldShowCustomerRebook("completed")).toBe(true);
    expect(shouldShowCustomerRebook("cancelled")).toBe(true);
    expect(shouldShowCustomerRebook("pending")).toBe(false);
    expect(shouldShowCustomerRebook("confirmed")).toBe(false);
    expect(shouldShowCustomerRebook("in_progress")).toBe(false);
  });
});

describe("customerRebookParams", () => {
  it("passes online serviceMode for online bookings", () => {
    expect(
      customerRebookParams({
        id: "b1",
        provider_id: "p1",
        status: "completed",
        service_mode: "online",
      }),
    ).toEqual({ providerId: "p1", rebookFrom: "b1", serviceMode: "online" });
  });

  it("omits serviceMode for in-person bookings", () => {
    expect(
      customerRebookParams({
        id: "b1",
        provider_id: "p1",
        status: "completed",
        service_mode: "in_person",
      }),
    ).toEqual({ providerId: "p1", rebookFrom: "b1" });
  });
});