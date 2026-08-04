import { describe, expect, it, vi } from "vitest";
import { isDestructiveCleanupEligible } from "../qa-classification.mjs";
import { assessDestructiveCleanupEligibility } from "../teardown-core.mjs";

describe("canonical QA classification parity", () => {
  it("rejects registry membership alone for real-looking users", () => {
    expect(isDestructiveCleanupEligible({
      email: "real-user@example.com",
      fullName: "QA_ Person",
      inRegistry: true,
    })).toBe(false);
  });

  it("allows deterministic qa-*@famio.local without registry", () => {
    expect(isDestructiveCleanupEligible({
      email: "qa-booking-a-1@famio.local",
      inRegistry: false,
    })).toBe(true);
  });

  it("allows phone-style QA user when registry + QA_ profile evidence intact", () => {
    expect(isDestructiveCleanupEligible({
      email: "phone-201001112233@famio.local",
      fullName: "QA_ Booking Provider",
      inRegistry: true,
    })).toBe(true);
  });

  it("assessDestructiveCleanupEligibility reads auth/profile before any mutation contract", async () => {
    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { email: "real-user@example.com" } },
          })),
        },
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { full_name: "QA_ Person" },
            })),
          })),
        })),
      })),
    };

    const assessment = await assessDestructiveCleanupEligibility(
      admin,
      "user-real",
      new Set(["user-real"]),
    );
    expect(assessment.eligible).toBe(false);
    expect(admin.auth.admin.getUserById).toHaveBeenCalledTimes(1);
    expect(admin.from).toHaveBeenCalled();
  });
});
