import { describe, expect, it, vi } from "vitest";
import { rebookProvidersFromBookings } from "../rebookProviders";

vi.mock("@/lib/i18n", () => ({ currentLang: () => "en" }));

const marketplaceProvider = {
  id: "provider-1",
  bio_en: "Bio",
  bio_ar: null,
  hourly_rate: 180,
  years_experience: 3,
  languages: ["Arabic"],
  city: "Cairo",
  is_top_pro: false,
  is_verified: true,
  profile: { full_name: "Mariam Hassan", avatar_url: "https://example.com/avatar.jpg" },
  ratings: { rating_avg: 4.8, rating_count: 12 },
  trust: { score: 92 },
  services: [{
    status: "approved",
    service: {
      slug: "home-cleaning",
      name_en: "Home cleaning",
      name_ar: "تنظيف",
      category: { slug: "home-cleaning" },
    },
  }],
};

describe("rebookProvidersFromBookings", () => {
  it("maps completed bookings to unique providers in booking order", () => {
    const bookings = [
      { status: "completed", provider_id: "provider-1", provider: marketplaceProvider, start_at: "2026-08-20T10:00:00Z" },
      { status: "completed", provider_id: "provider-1", provider: marketplaceProvider, start_at: "2026-08-10T10:00:00Z" },
      {
        status: "completed",
        provider_id: "provider-2",
        provider: { ...marketplaceProvider, id: "provider-2", profile: { full_name: "Sara Ali", avatar_url: null } },
        start_at: "2026-08-15T10:00:00Z",
      },
      { status: "cancelled", provider_id: "provider-3", provider: { ...marketplaceProvider, id: "provider-3" }, start_at: "2026-08-18T10:00:00Z" },
    ];

    const providers = rebookProvidersFromBookings(bookings);

    expect(providers).toHaveLength(2);
    expect(providers[0].id).toBe("provider-1");
    expect(providers[0].name).toBe("Mariam Hassan");
    expect(providers[1].id).toBe("provider-2");
    expect(providers[1].name).toBe("Sara Ali");
  });

  it("returns empty when there are no completed bookings with provider details", () => {
    expect(rebookProvidersFromBookings([
      { status: "pending", provider_id: "provider-1", provider: marketplaceProvider },
      { status: "completed", provider_id: "provider-2", provider: null },
    ])).toEqual([]);
  });
});
