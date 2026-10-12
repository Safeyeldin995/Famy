import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import en from "@/lib/i18n/locales/en";

const i18n = createInstance();
const query = <T,>(data: T) => ({
  data,
  isSuccess: true,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
});
const state = vi.hoisted(() => ({
  bookable: null as Map<string, number | null> | null,
  verified: true,
}));

const service = (
  id: string,
  slug: string,
  category: string,
  extra: Record<string, unknown> = {},
) => ({
  price_override: null,
  service: {
    id,
    slug,
    name_en: `${slug} name`,
    name_ar: `${slug} name`,
    pricing_model: "hourly",
    duration_min: 60,
    fixed_start_time: null,
    category: {
      slug: category,
      name_en: category === "tutoring" ? "Tutoring" : "Babysitting",
      name_ar: "x",
    },
    ...extra,
  },
});
const services = [
  service("s-hourly", "hourly-babysitting", "babysitting"),
  service("s-language", "language-tutoring", "tutoring"),
  service("s-subject", "school-subject-tutoring", "tutoring"),
];
const capabilities = [
  {
    id: "c1",
    serviceId: "s-subject",
    subjectCode: "math",
    subjectNameEn: "Math",
    subjectNameAr: "x",
    curriculumCode: "eg",
    curriculumNameEn: "Egyptian",
    curriculumNameAr: "x",
    levelCode: "g1",
    levelNameEn: "Grade 1",
    levelNameAr: "x",
    durationMin: 60,
    price: 400,
  },
  {
    id: "c2",
    serviceId: "s-subject",
    subjectCode: "math",
    subjectNameEn: "Math",
    subjectNameAr: "x",
    curriculumCode: "eg",
    curriculumNameEn: "Egyptian",
    curriculumNameAr: "x",
    levelCode: "g2",
    levelNameEn: "Grade 2",
    levelNameAr: "x",
    durationMin: 60,
    price: 400,
  },
];

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: i18n.t.bind(i18n), i18n }) }));
vi.mock("@/lib/i18n", () => ({ currentLang: () => "en" }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => vi.fn(),
  Link: ({
    to,
    children,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/famio/ui", () => ({
  PhoneFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}));
vi.mock("@/components/provider/ProfileAvatar", () => ({
  ProfileAvatar: ({ name }: { name: string }) => <span>{name.slice(0, 1)}</span>,
}));
vi.mock("@/lib/auth/providerOnlyCustomerGuard", () => ({
  useProviderOnlyCustomerRedirect: () => ({ blocking: false }),
}));
vi.mock("@/lib/db/queries", () => ({
  useDefaultAddress: () => query({ id: "addr" }),
  useProvider: () =>
    query({
      id: "p1",
      full_name: "Mona Adel",
      profile: { full_name: "Mona Adel", avatar_url: null },
      hourly_rate: 250,
      is_verified: state.verified,
      years_experience: 3,
      city: "Zayed",
      languages: ["ar"],
      services: [{ status: "approved", service: { category: { slug: "babysitting" } } }],
      ratings: { rating_avg: 0, rating_count: 0 },
    }),
  useProviderReviews: () => query([]),
  useProviderServices: () => query(services),
  useBookableServiceIds: () => query(state.bookable),
  useFavoriteIds: () => query([]),
  useToggleFavorite: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/lib/db/teaching-queries", () => ({
  useApprovedTeachingCapabilities: () => query(capabilities),
}));
vi.mock("@/lib/db/provider-queries", () => ({
  useProviderAvailability: () =>
    query([{ weekday: 0, start_time: "09:00:00", end_time: "17:00:00" }]),
}));

const { ProviderProfileContent } = await import("../provider.$id");

beforeEach(async () => {
  state.bookable = null;
  state.verified = true;
  await i18n.init({
    lng: "en",
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
});
afterEach(cleanup);

describe("customer provider page", () => {
  it("never renders stock gallery photos or unverified badges", () => {
    const { container } = render(<ProviderProfileContent providerId="p1" />);
    expect(container.querySelector('img[src*="picsum"]')).toBeNull();
    expect(screen.queryByText(/background check/i)).toBeNull();
    expect(screen.queryByText(/first aid/i)).toBeNull();
    expect(screen.getByText("ID verified")).toBeTruthy();
  });

  it("hides the ID badge when the provider is not verified", () => {
    state.verified = false;
    render(<ProviderProfileContent providerId="p1" />);
    expect(screen.queryByText("ID verified")).toBeNull();
  });

  it("shows only services the customer can actually book", () => {
    state.bookable = new Map([
      ["s-hourly", 200],
      ["s-subject", 400],
    ]);
    render(<ProviderProfileContent providerId="p1" />);
    expect(screen.getByText("hourly-babysitting name")).toBeTruthy();
    expect(screen.getByText("Math · Egyptian")).toBeTruthy();
    expect(screen.getByText("Grade 1 to Grade 2")).toBeTruthy();
    expect(screen.queryByText("language-tutoring name")).toBeNull();
  });

  it("hides booking when nothing is bookable", () => {
    state.bookable = new Map();
    render(<ProviderProfileContent providerId="p1" />);
    expect(screen.queryByRole("button", { name: /book with/i })).toBeNull();
    expect(screen.getByText(/can't be booked right now/i)).toBeTruthy();
  });
});
