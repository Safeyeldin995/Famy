import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { PREVIEW_NOW_ISO, PREVIEW_PROVIDER_ID, PREVIEW_USER_ID } from "@/lib/preview/constants";
import { previewBookings, seedPreviewAdminQueries } from "@/lib/preview/mockData";

describe("preview mock data", () => {
  it("seeds admin eligibility with the checklist fields the provider page maps", () => {
    const qc = new QueryClient();
    seedPreviewAdminQueries(qc);
    const rows = qc.getQueryData<Array<Record<string, unknown>>>([
      "admin",
      "provider-eligibility",
      PREVIEW_PROVIDER_ID,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({
      service_id: "svc-clean",
      service_name_en: "Deep home clean",
      identity_valid: true,
      is_eligible: true,
      failure_reasons: [],
    });
    expect(Array.isArray(rows![0].failure_reasons)).toBe(true);
  });

  it("uses a frozen clock so SSR and client seeds match", () => {
    const qcA = new QueryClient();
    const qcB = new QueryClient();
    seedPreviewAdminQueries(qcA);
    seedPreviewAdminQueries(qcB);

    const bookingsA = qcA.getQueryData<Array<{ start_at: string; created_at: string }>>([
      "admin",
      "bookings",
      "all",
    ]);
    const bookingsB = qcB.getQueryData<Array<{ start_at: string; created_at: string }>>([
      "admin",
      "bookings",
      "all",
    ]);
    expect(bookingsA![0].start_at).toBe("2026-09-03T10:00:00.000Z");
    expect(bookingsA![0].start_at).toBe(bookingsB![0].start_at);
    expect(bookingsA![0].created_at).toBe(bookingsB![0].created_at);

    const paymentsA = qcA.getQueryData<Array<{ created_at: string }>>(["admin", "payments", "all"]);
    const paymentsB = qcB.getQueryData<Array<{ created_at: string }>>(["admin", "payments", "all"]);
    expect(paymentsA![0].created_at).toBe(PREVIEW_NOW_ISO);
    expect(paymentsA![0].created_at).toBe(paymentsB![0].created_at);

    const customerA = qcA.getQueryData<{ profile: { created_at: string } }>([
      "admin",
      "customer",
      PREVIEW_USER_ID,
    ]);
    const customerB = qcB.getQueryData<{ profile: { created_at: string } }>([
      "admin",
      "customer",
      PREVIEW_USER_ID,
    ]);
    expect(customerA!.profile.created_at).toBe(customerB!.profile.created_at);
    expect(previewBookings[0].start_at).toBe("2026-09-03T10:00:00.000Z");
  });
});
