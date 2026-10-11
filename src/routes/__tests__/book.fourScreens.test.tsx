import type { ReactNode, AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createInstance } from "i18next";
import en from "@/lib/i18n/locales/en";
import ar from "@/lib/i18n/locales/ar";
import {
  bookingPreviewServices,
  bookingPreviewCapability,
} from "@/lib/preview/customerBookingPreview";
import { cairoWallTime } from "@/lib/pricing/servicePackages";

const state = vi.hoisted(() => ({
  lang: "en",
  requirementsSuccess: true,
  requirements: [] as {
    id: string;
    name_en: string;
    name_ar: string;
    required_during_booking: boolean;
    fulfillment_mode: string;
    provider_extra_fee: number;
  }[],
  create: vi.fn(),
  payment: vi.fn(),
  navigate: vi.fn(),
  clash: false,
}));
const i18n = createInstance();
const query = <T,>(data: T) => ({
  data,
  isSuccess: true,
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: vi.fn(),
});
const member = {
  id: "child-fixture",
  full_name: "Child fixture",
  relationship: "son",
  date_of_birth: "2020-05-12",
  is_active: true,
  education_curriculum_id: "egypt",
  education_level_id: "grade-1",
};
const members = [member];
const services = bookingPreviewServices.map((service) => ({
  service,
  price_override: service.rate,
}));
const capabilities = [
  bookingPreviewCapability,
  { ...bookingPreviewCapability, id: "90", durationMin: 90, price: 600 },
];
const slotCache = new Map<string, { label: string; start: Date; end: Date }[]>();
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: i18n.t.bind(i18n), i18n }) }));
vi.mock("@/lib/i18n", () => ({ currentLang: () => state.lang }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => state.navigate,
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
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  EmptyState: ({ title, action }: { title: string; action: ReactNode }) => (
    <div>
      {title}
      {action}
    </div>
  ),
}));
vi.mock("@/components/booking/BookingDetailsSheet", () => ({
  BookingDetailsSheet: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>Close add details</button>
  ),
}));
vi.mock("@/components/famio/EducationProfileFields", () => ({
  EducationProfileFields: () => <div>School fields</div>,
  educationValueFromIds: (curriculumId: string | null, levelId: string | null) => ({
    educationCurriculumId: curriculumId ?? "",
    educationLevelId: levelId ?? "",
  }),
}));
vi.mock("@/lib/auth/providerOnlyCustomerGuard", () => ({
  useProviderOnlyCustomerRedirect: () => ({ blocking: false }),
}));
vi.mock("@/lib/db/queries", () => ({
  useProvider: () =>
    query({
      id: "p1",
      profile: { full_name: "Provider fixture", avatar_url: null },
      hourly_rate: 250,
      ratings: { rating_avg: 4.9, rating_count: 38 },
    }),
  useAvatarUrl: () => query(null),
  useProviderServices: () => query(services),
  useFixedPackageRate: () => query(null),
  useAddresses: () =>
    query([
      {
        id: "address-fixture",
        label: "home",
        street: "Fixture street",
        area: "Fixture area",
        lat: 30,
        lng: 31,
        is_default: true,
      },
    ]),
  useResolveZone: () =>
    query({ name_en: "Fixture area", name_ar: "منطقة الاختبار", travel_fee: 0 }),
  useProviderBookingSettings: () => query({ max_advance_days: 30 }),
  useMyProfile: () => query({ full_name: "Customer fixture" }),
  useAvailableSlots: (
    _providerId: string,
    day: Date | null,
    minutes: number,
    opts: { cairoTime: boolean; fixedStartTime: string | null; includeUnavailable?: boolean },
  ) => {
    const date = day ?? new Date();
    const start = opts.cairoTime
      ? cairoWallTime(date, opts.fixedStartTime ?? "09:00")
      : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9);
    const key = `${start.toISOString()}:${minutes}:${!!opts.includeUnavailable}`;
    if (!slotCache.has(key))
      slotCache.set(key, [
        {
          label: opts.fixedStartTime ? "6:00 PM" : "9:00 AM",
          start,
          end: new Date(+start + minutes * 60000),
        },
      ]);
    if (opts.includeUnavailable && slotCache.get(key)?.length === 1) {
      slotCache.get(key)?.push({
        label: "Unavailable",
        start: new Date(+start + 3600000),
        end: new Date(+start + (minutes + 60) * 60000),
      });
    }
    return query(slotCache.get(key));
  },
  useCreateBooking: () => ({ mutateAsync: state.create, isPending: false }),
}));
vi.mock("@/lib/db/family-members-queries", () => ({
  useActiveFamilyMembers: () => query(members),
}));
vi.mock("@/lib/db/teaching-queries", () => ({
  useApprovedTeachingCapabilities: () => query(capabilities),
}));
vi.mock("@/lib/db/student-education-queries", () => ({
  useCustomerEducationProfile: () => query(null),
  useSaveStudentEducationProfile: () => ({ save: vi.fn() }),
}));
vi.mock("@/lib/db/provider-queries", () => ({
  useRequirementsForService: () => ({
    ...query(state.requirements),
    isSuccess: state.requirementsSuccess,
    isLoading: !state.requirementsSuccess,
  }),
}));
vi.mock("@/lib/db/settings-queries", () => ({
  useBillingSettings: () => query({ platform_fee: 25, vat_percent: 14 }),
  DEFAULT_BILLING_SETTINGS: { platform_fee: 25, vat_percent: 14 },
}));
vi.mock("@/lib/db/payment-methods-queries", () => ({
  useActivePaymentMethods: () =>
    query([
      {
        id: "cash-fixture",
        code: "cash",
        method_type: "cash",
        name_en: "Cash",
        name_ar: "كاش",
        is_default: true,
      },
    ]),
}));
vi.mock("@/lib/db/payment-queries", () => ({
  useCreatePayment: () => ({ mutateAsync: state.payment }),
  mapPaymentInsertError: () => "Payment error",
}));
vi.mock("@/lib/db/promo-codes-queries", () => ({ validatePromoCode: vi.fn() }));
vi.mock("@/lib/paymob/paymobRedirect", () => ({ redirectToPaymobCheckout: vi.fn() }));
vi.mock("@/lib/push-prompt", () => ({ markCustomerPushPromptPending: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        lt: () => builder,
        gt: () => builder,
        limit: async () => ({ data: state.clash ? [{ id: "taken" }] : [], error: null }),
      };
      return builder;
    },
  },
}));

import { BookContent } from "../book.$providerId";
const next = () =>
  screen.getByRole("button", {
    name: new RegExp(`^${i18n.t("customerBooking.next", { total: "" }).split(" · ")[0]}`),
  });
const title = (key: string) =>
  screen.getByRole("heading", {
    name: i18n.t(`customerBooking.titles.${key}`, { name: "Provider" }),
  });
async function selectTime() {
  await waitFor(() => expect(title("when")).toBeTruthy());
  const buttons = document.querySelectorAll<HTMLButtonElement>(".booking-time");
  fireEvent.click(buttons[0]);
  fireEvent.click(next());
}
async function toReview(serviceId = "booking-hourly") {
  render(<BookContent providerId="p1" searchServiceId={serviceId} />);
  fireEvent.click(next());
  await selectTime();
  fireEvent.click(screen.getByRole("button", { name: "Child fixture" }));
  fireEvent.click(next());
  expect(title("review")).toBeTruthy();
}
beforeEach(async () => {
  state.lang = "en";
  state.requirementsSuccess = true;
  state.requirements = [];
  state.clash = false;
  state.create
    .mockReset()
    .mockResolvedValue({ id: "booking-fixture", created: true, price_total: 1165 });
  state.payment.mockReset().mockResolvedValue({ id: "payment-fixture" });
  state.navigate.mockReset();
  await i18n.init({
    lng: "en",
    resources: { en: { translation: en }, ar: { translation: ar } },
    interpolation: { escapeValue: false },
  });
});
afterEach(cleanup);

describe("four-screen booking journey", () => {
  it.each(["en", "ar"])(
    "keeps review edits and added-details cancellation in the same draft in %s",
    async (lang) => {
      state.lang = lang;
      await i18n.changeLanguage(lang);
      await toReview();
      fireEvent.click(
        screen.getByRole("button", {
          name: `${i18n.t("common.edit")} ${i18n.t("bookFlow.rowAddress")}`,
        }),
      );
      expect(title("whereWho")).toBeTruthy();
      const notes = screen.getByRole("textbox", { name: i18n.t("bookFlow.notesTitle") });
      fireEvent.change(notes, { target: { value: "Keep draft" } });
      fireEvent.click(screen.getByRole("button", { name: i18n.t("familyMembers.addMember") }));
      fireEvent.click(screen.getByRole("button", { name: "Close add details" }));
      expect((notes as HTMLTextAreaElement).value).toBe("Keep draft");
      fireEvent.click(next());
      expect(title("review")).toBeTruthy();
      expect(screen.getByText("Keep draft")).toBeTruthy();
    },
  );
  it.each(["booking-hourly", "booking-day", "booking-night"])(
    "submits the same payload for %s through four screens",
    async (serviceId) => {
      await toReview(serviceId);
      fireEvent.click(screen.getByRole("button", { name: /^Confirm booking ·/ }));
      await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
      const payload = state.create.mock.calls[0][0];
      expect(payload).toEqual({
        provider_id: "p1",
        service_id: serviceId,
        address_id: "address-fixture",
        family_member_id: "child-fixture",
        start_at: expect.any(String),
        end_at: expect.any(String),
        promo_code_id: null,
        notes: null,
        requirement_selections: [],
        teaching_capability_id: null,
        teaching_subject_code: null,
        teaching_curriculum_code: null,
        teaching_level_code: null,
        idempotency_key: expect.any(String),
      });
      expect((Date.parse(payload.end_at) - Date.parse(payload.start_at)) / 3600000).toBe(
        serviceId === "booking-hourly" ? 4 : serviceId === "booking-day" ? 8 : 6,
      );
    },
  );
  it("keeps unknown requirements blocked inline, then requires an explicit either choice", async () => {
    state.requirementsSuccess = false;
    const view = render(<BookContent providerId="p1" />);
    fireEvent.click(next());
    await selectTime();
    fireEvent.click(screen.getByRole("button", { name: "Child fixture" }));
    expect((next() as HTMLButtonElement).disabled).toBe(true);
    state.requirementsSuccess = true;
    state.requirements = [
      {
        id: "req",
        name_en: "Fixture requirement",
        name_ar: "متطلب الاختبار",
        required_during_booking: true,
        fulfillment_mode: "either",
        provider_extra_fee: 50,
      },
    ];
    view.rerender(<BookContent providerId="p1" />);
    expect((next() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("bookFlow.reqIWillProvide") }));
    expect((next() as HTMLButtonElement).disabled).toBe(false);
  });
  it("renders tutoring recipient, grouped subject and approved duration choices on screen one", async () => {
    render(<BookContent providerId="p1" searchServiceId="booking-tutoring" />);
    fireEvent.click(screen.getByRole("button", { name: "Child fixture" }));
    // Two approved durations require a subject-group choice; the existing autofill
    // intentionally does not select an ambiguous capability automatically.
    fireEvent.click(screen.getByRole("button", { name: /Math · Egyptian · Grade 1/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: i18n.t("bookFlow.sessionLine", { minutes: "90" }) }),
      ).toBeTruthy(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("bookFlow.sessionLine", { minutes: "90" }) }),
    );
    expect(title("service")).toBeTruthy();
    fireEvent.click(next());
    await selectTime();
    fireEvent.click(next());
    expect(title("review")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Confirm booking ·/ }));
    await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
    expect(state.create.mock.calls[0][0]).toMatchObject({
      teaching_capability_id: "90",
      teaching_subject_code: "math",
      teaching_curriculum_code: "egypt",
      teaching_level_code: "grade-1",
      family_member_id: "child-fixture",
    });
  });
  it("disables unavailable time candidates and keeps them out of selection", async () => {
    render(<BookContent providerId="p1" />);
    fireEvent.click(next());
    await waitFor(() => expect(title("when")).toBeTruthy());
    const blocked = document.querySelector<HTMLButtonElement>(".booking-time:disabled");
    expect(blocked).not.toBeNull();
    if (!blocked) throw new Error("Expected unavailable chip");
    fireEvent.click(blocked);
    expect((next() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(document.querySelector<HTMLButtonElement>(".booking-time:not(:disabled)")!);
    expect((next() as HTMLButtonElement).disabled).toBe(false);
  });
  it("shows slot-taken errors inline on When and keeps the other choices", async () => {
    await toReview();
    state.clash = true;
    fireEvent.click(screen.getByRole("button", { name: /^Confirm booking ·/ }));
    await waitFor(() => expect(title("when")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toBe(i18n.t("bookFlow.slotTaken"));
    expect(state.create).not.toHaveBeenCalled();
  });
});
