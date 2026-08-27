import { describe, expect, it } from "vitest";
import {
  STALE_QA_SERVICES_CONFIRM_VALUE,
  STALE_QA_SERVICES_OVERRIDE_CONFIRM_VALUE,
  parseStaleQaServicesArgs,
} from "../stale-qa-services-args.mjs";
import { fingerprintStaleQaServicesPlan } from "../stale-qa-services-fingerprint.mjs";
import { matchesStaleQaServiceFilter } from "../stale-qa-services-planner.mjs";
import { KNOWN_QA_PROJECT_REF } from "../qa-identity.mjs";

describe("stale QA services args", () => {
  it("defaults to dry-run", () => {
    expect(parseStaleQaServicesArgs([])).toEqual({
      mode: "dry-run",
      overrideImmutableHistory: false,
    });
  });

  it("requires confirm phrase and fingerprint for execute", () => {
    expect(parseStaleQaServicesArgs(["--execute"]).mode).toBe("rejected");
    expect(
      parseStaleQaServicesArgs([
        "--execute",
        `--confirm=${STALE_QA_SERVICES_CONFIRM_VALUE}`,
        `--plan-fingerprint=${"a".repeat(64)}`,
      ]).mode,
    ).toBe("execute");
  });

  it("rejects override flag without override confirm", () => {
    expect(parseStaleQaServicesArgs(["--override-immutable-history"]).mode).toBe("rejected");
  });

  it("accepts override only when both override flags are present", () => {
    expect(
      parseStaleQaServicesArgs([
        "--override-immutable-history",
        `--override-confirm=${STALE_QA_SERVICES_OVERRIDE_CONFIRM_VALUE}`,
      ]),
    ).toEqual({
      mode: "dry-run",
      overrideImmutableHistory: true,
      overrideConfirmValue: STALE_QA_SERVICES_OVERRIDE_CONFIRM_VALUE,
    });
  });

  it("rejects dangerous flags", () => {
    expect(parseStaleQaServicesArgs(["--force"]).mode).toBe("rejected");
  });
});

describe("matchesStaleQaServiceFilter", () => {
  it("matches inactive QA-prefixed English names", () => {
    expect(
      matchesStaleQaServiceFilter({
        name_en: "QA Booking Service 123",
        slug: "booking-service-123",
        is_active: false,
      }),
    ).toBe(true);
  });

  it("matches inactive qa- slugs", () => {
    expect(
      matchesStaleQaServiceFilter({
        name_en: "Legacy Name",
        slug: "qa-patch2-booking-1",
        is_active: false,
      }),
    ).toBe(true);
  });

  it("rejects active services even when QA-tagged", () => {
    expect(
      matchesStaleQaServiceFilter({
        name_en: "QA Booking Service 123",
        slug: "qa-booking-123",
        is_active: true,
      }),
    ).toBe(false);
  });
});

describe("stale QA services fingerprint", () => {
  it("is stable for identical plans", () => {
    const payload = {
      projectRef: KNOWN_QA_PROJECT_REF,
      overrideImmutableHistory: false,
      immutableOverrideCounts: {
        audit_logs: 0,
        booking_cancellations: 0,
        messages: 0,
        conversations: 0,
      },
      services: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          name_en: "QA Booking Service 1",
          slug: "qa-booking-1",
          bookingCount: 2,
          deletableBookingCount: 2,
          retainedBookingCount: 0,
          deletable: true,
          retainReason: null,
          dependentCounts: { bookings: 2, services: 1 },
        },
      ],
      deletions: [{ table: "bookings", phase: "booking", keyCount: 2, resourceKey: "services:111" }],
      retained: [],
    };
    const first = fingerprintStaleQaServicesPlan(payload);
    const second = fingerprintStaleQaServicesPlan(payload);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });

  it("changes when override mode is enabled", () => {
    const base = {
      projectRef: KNOWN_QA_PROJECT_REF,
      services: [],
      deletions: [],
      retained: [],
      immutableOverrideCounts: {
        audit_logs: 1,
        booking_cancellations: 2,
        messages: 3,
        conversations: 4,
      },
    };
    const withoutOverride = fingerprintStaleQaServicesPlan({
      ...base,
      overrideImmutableHistory: false,
    });
    const withOverride = fingerprintStaleQaServicesPlan({
      ...base,
      overrideImmutableHistory: true,
    });
    expect(withoutOverride).not.toBe(withOverride);
  });
});
