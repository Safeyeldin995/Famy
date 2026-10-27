// Customer data operations ported from the named web data modules. Same RPCs, arguments and guards.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { cairoWallTime, packageRuleStart } from "@shared/pricing/servicePackages";
import { creationMinHours, parseBookingExpirySettings } from "@shared/booking/pending-expiry";
import { mapBookingRpcError } from "@shared/booking/errors";
import { completeCreateBookingResult } from "./bookingPure";
import {
  ADDRESSES_QUERY_ROOT,
  ADDRESS_QUERY_ROOT,
  DEFAULT_ADDRESS_QUERY_ROOT,
} from "@shared/db/address-query-keys";
import type { Database } from "../../../src/integrations/supabase/types";
type Tables = Database["public"]["Tables"];
export type AddressLabel = "home" | "work" | "family" | "other";
export type AddressInput = {
  label: AddressLabel;
  custom_label?: string | null;
  city: string;
  area?: string | null;
  street: string;
  building?: string | null;
  floor?: string | null;
  apartment?: string | null;
  compound?: string | null;
  landmark?: string | null;
  access_notes?: string | null;
  lat?: number | null;
  lng?: number | null;
  is_default?: boolean;
};

// line1/line2 are legacy required-for-compat columns nothing in the UI
// reads anymore — derived here so every write still satisfies the schema.
function toAddressRow(input: AddressInput) {
  const line2Parts = [input.compound, input.building, input.apartment, input.access_notes].filter(
    (v): v is string => !!v && v.trim().length > 0,
  );
  return {
    label: input.label,
    custom_label: input.label === "other" ? input.custom_label?.trim() || null : null,
    city: input.city,
    area: input.area ?? null,
    street: input.street,
    building: input.building ?? null,
    floor: input.floor ?? null,
    apartment: input.apartment ?? null,
    compound: input.compound ?? null,
    landmark: input.landmark ?? null,
    access_notes: input.access_notes ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    line1: input.street,
    line2: line2Parts.length > 0 ? line2Parts.join(" · ") : null,
  };
}

export function useCreateAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddressInput) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("auth required");
      const { data, error } = await supabase
        .from("addresses")
        .insert({ ...toAddressRow(input), user_id: user.id, is_default: input.is_default ?? false })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, _input, _ctx) => {
      qc.invalidateQueries({ queryKey: [ADDRESSES_QUERY_ROOT] });
      qc.invalidateQueries({ queryKey: [DEFAULT_ADDRESS_QUERY_ROOT] });
    },
  });
}

export function useResolveZone(lat: number | null | undefined, lng: number | null | undefined) {
  return useQuery({
    enabled: lat != null && lng != null,
    queryKey: ["resolve-zone", lat, lng],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("resolve_zone", { p_lat: lat!, p_lng: lng! });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}

export function useUpdateAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddressInput & { id: string }) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("auth required");
      const { data, error } = await supabase
        .from("addresses")
        .update({
          ...toAddressRow(input),
          ...(input.is_default === undefined ? {} : { is_default: input.is_default }),
        })
        .eq("id", input.id)
        .eq("user_id", session.user.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      for (const key of [ADDRESSES_QUERY_ROOT, ADDRESS_QUERY_ROOT, DEFAULT_ADDRESS_QUERY_ROOT])
        void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

// ---------- Categories ----------

const ACTIVE_BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "on_the_way",
  "arrived",
  "arrival_confirmed",
  "in_progress",
  "completion_requested",
] as const;

type ProviderBookingSettings = {
  vacation_mode: boolean;
  min_notice_hours: number;
  max_advance_days: number;
  buffer_minutes: number;
};

async function fetchProviderBookingSettings(
  providerId: string,
  opts?: { serviceId?: string; addressId?: string },
): Promise<ProviderBookingSettings | null> {
  const args: { p_provider_id: string; p_service_id?: string; p_address_id?: string } = {
    p_provider_id: providerId,
  };
  if (opts?.serviceId) args.p_service_id = opts.serviceId;
  if (opts?.addressId) args.p_address_id = opts.addressId;
  const { data, error } = await supabase.rpc("marketplace_provider_booking_settings", args);
  if (error) throw error;
  return data?.[0] ?? null;
}

export function useProviderBookingSettings(
  providerId: string | undefined,
  opts?: { serviceId?: string | null; addressId?: string | null },
) {
  return useQuery({
    enabled: !!providerId,
    queryKey: [
      "provider-booking-settings",
      providerId,
      opts?.serviceId ?? null,
      opts?.addressId ?? null,
    ],
    queryFn: async () =>
      fetchProviderBookingSettings(providerId!, {
        serviceId: opts?.serviceId ?? undefined,
        addressId: opts?.addressId ?? undefined,
      }),
  });
}

// Resolves a provider's REAL open slots for a given date, replacing the
// hardcoded timeSlots array that previously showed the same fixed times to
// every customer regardless of the provider's actual schedule. Combines:
//   1. availability_rules (weekly recurring pattern, by weekday)
//   2. provider_vacations (date-range blocks) + availability_exceptions (single-day/partial blocks)
//   3. providers.vacation_mode / min_notice_hours / max_advance_days / buffer_minutes
//   4. existing active bookings that day (to exclude already-taken times, with buffer)
// The database's own exclusion constraint + BEFORE INSERT validation trigger
// on `bookings` remain the final, authoritative safety net if two customers
// race for the same slot — this function is a UX layer on top of that.
export function useAvailableSlots(
  providerId: string | undefined,
  date: Date | null,
  slotMinutes = 120,
  opts?: {
    serviceId?: string | null;
    addressId?: string | null;
    cairoTime?: boolean;
    fixedStartTime?: string | null;
    includeUnavailable?: boolean;
  },
) {
  return useQuery({
    enabled: !!providerId && !!date,
    queryKey: [
      "available-slots",
      providerId,
      date?.toDateString(),
      slotMinutes,
      opts?.serviceId ?? null,
      opts?.addressId ?? null,
      opts?.cairoTime ?? false,
      opts?.fixedStartTime ?? null,
      ...(opts?.includeUnavailable ? ["include-unavailable"] : []),
    ],
    queryFn: async () => {
      const d = date!;
      const weekday = d.getDay();
      const dayStart = new Date(d);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(d);
      dayEnd.setHours(23, 59, 59, 999);
      const dateStr = opts?.cairoTime
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
        : dayStart.toISOString().slice(0, 10);
      const atTime = (hour: number, minute: number) => {
        if (opts?.cairoTime) return cairoWallTime(d, `${hour}:${minute}`);
        const value = new Date(d);
        value.setHours(hour, minute, 0, 0);
        return value;
      };
      const queryStart = opts?.cairoTime ? atTime(0, 0) : dayStart;
      const queryEnd = opts?.cairoTime ? new Date(+atTime(24, 0) - 1) : dayEnd;

      const provider = await fetchProviderBookingSettings(providerId!, {
        serviceId: opts?.serviceId ?? undefined,
        addressId: opts?.addressId ?? undefined,
      });
      if (!provider) return [];

      const [rulesRes, vacRes, excRes, bookingsRes, expiryRes] = await Promise.all([
        supabase
          .from("availability_rules")
          .select("start_time, end_time")
          .eq("provider_id", providerId!)
          .eq("weekday", weekday),
        supabase
          .from("provider_vacations")
          .select("start_date, end_date")
          .eq("provider_id", providerId!)
          .lte("start_date", dateStr)
          .gte("end_date", dateStr),
        supabase
          .from("availability_exceptions")
          .select("start_time, end_time, is_blocked, date, end_date")
          .eq("provider_id", providerId!)
          .lte("date", dateStr),
        supabase
          .from("bookings")
          .select("start_at, end_at")
          .eq("provider_id", providerId!)
          .in("status", ACTIVE_BOOKING_STATUSES)
          .gte("start_at", queryStart.toISOString())
          .lte("start_at", queryEnd.toISOString()),
        supabase.from("settings").select("value").eq("key", "booking_expiry").maybeSingle(),
      ]);
      if (rulesRes.error) throw rulesRes.error;
      if (vacRes.error) throw vacRes.error;
      if (excRes.error) throw excRes.error;
      if (bookingsRes.error) throw bookingsRes.error;
      if (expiryRes.error) throw expiryRes.error;

      if (provider.vacation_mode) return [];
      // Provider is on vacation this date — no slots at all.
      if ((vacRes.data ?? []).length > 0) return [];

      const exceptions = (excRes.data ?? []).filter(
        (e) => e.is_blocked && (e.end_date ?? e.date) >= dateStr,
      );
      // A full-day exception (no start/end time) blocks the whole date.
      if (exceptions.some((e) => !e.start_time || !e.end_time)) return [];

      const now = new Date();
      const expiry = parseBookingExpirySettings(expiryRes.data?.value);
      const earliestAllowed = new Date(
        now.getTime() + creationMinHours(provider.min_notice_hours, expiry) * 3600000,
      );
      const latestAllowed = new Date(now.getTime() + provider.max_advance_days * 86400000);
      const bufferMs = provider.buffer_minutes * 60000;

      const rules = rulesRes.data ?? [];
      const booked = bookingsRes.data ?? [];
      const slots: { label: string; start: Date; end: Date; available?: boolean }[] = [];

      for (const rule of rules) {
        const alignedStart = packageRuleStart(rule.start_time, opts?.fixedStartTime);
        if (!alignedStart) continue;
        const [sh, sm] = alignedStart.split(":").map(Number);
        const [eh, em] = rule.end_time.split(":").map(Number);
        let cursor = atTime(sh, sm);
        const ruleEnd = atTime(eh, em);

        while (+cursor + slotMinutes * 60000 <= +ruleEnd) {
          const slotEnd = new Date(+cursor + slotMinutes * 60000);
          const withinWindow = cursor >= earliestAllowed && cursor <= latestAllowed;
          const overlapsBooking = booked.some((b) => {
            const bs = new Date(+new Date(b.start_at) - bufferMs),
              be = new Date(+new Date(b.end_at) + bufferMs);
            return +cursor < +be && +slotEnd > +bs;
          });
          const overlapsException = exceptions.some((e) => {
            if (!e.start_time || !e.end_time) return true;
            const [xsh, xsm] = e.start_time.split(":").map(Number);
            const [xeh, xem] = e.end_time.split(":").map(Number);
            const xs = atTime(xsh, xsm);
            const xe = atTime(xeh, xem);
            return +cursor < +xe && +slotEnd > +xs;
          });
          const available = withinWindow && !overlapsBooking && !overlapsException;
          // Opt-in presentation only: the normal booking query still returns available slots only.
          if (available || opts?.includeUnavailable) {
            slots.push({
              label: cursor.toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
                ...(opts?.cairoTime ? { timeZone: "Africa/Cairo" } : {}),
              }),
              start: new Date(cursor),
              end: slotEnd,
              ...(opts?.includeUnavailable ? { available } : {}),
            });
          }
          cursor = new Date(+cursor + slotMinutes * 60000);
        }
      }
      return slots;
    },
  });
}

export type CreateBookingInput = {
  provider_id: string;
  service_id: string;
  address_id: string;
  start_at: string;
  end_at: string;
  idempotency_key: string;
  family_member_id?: string | null;
  notes?: string | null;
  promo_code_id?: string | null;
  requirement_selections?: Tables["bookings"]["Insert"]["requirement_selections"];
  teaching_capability_id?: string | null;
  teaching_subject_code?: string | null;
  teaching_curriculum_code?: string | null;
  teaching_level_code?: string | null;
};

export type CreateBookingResult = Tables["bookings"]["Row"] & {
  idempotent_replay: boolean;
  created: boolean;
  fetch_degraded?: boolean;
};

export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: CreateBookingInput,
    ): Promise<import("./bookingPure").CompletedCreateBookingResult> => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error("auth required");
      }
      const { data, error } = await supabase.rpc("create_booking", {
        p_provider_id: input.provider_id,
        p_service_id: input.service_id,
        p_address_id: input.address_id,
        p_start_at: input.start_at,
        p_end_at: input.end_at,
        p_idempotency_key: input.idempotency_key,
        p_family_member_id: input.family_member_id ?? undefined,
        p_notes: input.notes ?? undefined,
        p_promo_code_id: input.promo_code_id ?? undefined,
        p_requirement_selections: (input.requirement_selections ?? []) as never,
        p_teaching_capability_id: input.teaching_capability_id ?? undefined,
        p_teaching_subject_code: input.teaching_subject_code ?? undefined,
        p_teaching_curriculum_code: input.teaching_curriculum_code ?? undefined,
        p_teaching_level_code: input.teaching_level_code ?? undefined,
      });
      if (error) {
        throw mapBookingRpcError(error);
      }
      const payload = data as { booking_id: string; created: boolean; idempotent_replay: boolean };
      return completeCreateBookingResult(
        payload,
        async (id) => {
          const { data, error } = await supabase.from("bookings").select("*").eq("id", id).single();
          return { data, error };
        },
        { retryDelayMs: 250 },
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-bookings"] }),
  });
}

export function useBookingReview(bookingId: string | undefined) {
  return useQuery({
    enabled: !!bookingId,
    queryKey: ["booking-review", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reviews")
        .select("*")
        .eq("booking_id", bookingId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useSubmitReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      bookingId: string;
      providerId: string;
      rating: number;
      comment?: string;
    }) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("auth required");
      const { data, error } = await supabase
        .from("reviews")
        .insert({
          booking_id: input.bookingId,
          provider_id: input.providerId,
          customer_id: user.id,
          rating: input.rating,
          comment: input.comment || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["booking-review", vars.bookingId] });
    },
  });
}

// ---------- Provider services (for booking) ----------
export function useFixedPackageRate(
  providerId: string,
  serviceId: string | undefined,
  addressId?: string | null,
) {
  return useQuery({
    enabled: !!serviceId,
    queryKey: ["fixed-package-rate", providerId, serviceId, addressId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_marketplace_providers", {
        p_service_id: serviceId!,
        ...(addressId ? { p_address_id: addressId } : {}),
      });
      if (error) throw error;
      const row = data?.find((row: { id: string; hourly_rate: number }) => row.id === providerId);
      return row ? Number(row.hourly_rate) : null;
    },
  });
}

// Ported from src/lib/db/payment-queries.ts
export function useCreatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      bookingId: string;
      paymentMethodId: string;
      /** Only used to pick the initial status (manual_transfer = pending_review; cash/online = pending); the row's actual method details are copied server-side from payment_method_id. */
      methodType: "cash" | "manual_transfer" | "online";
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("auth required");

      const { data: booking, error: bookingErr } = await supabase
        .from("bookings")
        .select("price_total, currency, customer_id")
        .eq("id", input.bookingId)
        .single();
      if (bookingErr) throw bookingErr;
      if (booking.customer_id !== user.id) {
        throw new Error("You cannot record payment for this booking.");
      }
      const amount = Number(booking.price_total);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Booking total is not available yet.");
      }

      const status: PaymentStatus =
        input.methodType === "manual_transfer" ? "pending_review" : "pending";
      const { data, error } = await supabase
        .from("payments")
        .insert({
          booking_id: input.bookingId,
          customer_id: user.id,
          payment_method_id: input.paymentMethodId,
          amount,
          currency: booking.currency ?? "EGP",
          status: status,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["payment", v.bookingId] }),
  });
}

// Ported from src/lib/db/payment-methods-queries.ts
export type MethodType = "cash" | "manual_transfer" | "online";

export type PaymentMethodRow = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  instructions_en: string | null;
  instructions_ar: string | null;
  method_type: MethodType;
  is_active: boolean;
  is_default: boolean;
  display_order: number;
  public_config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PaymentMethodInput = {
  code: string;
  name_en: string;
  name_ar: string;
  instructions_en: string | null;
  instructions_ar: string | null;
  method_type: MethodType;
  is_active: boolean;
  display_order: number;
  public_config: Record<string, unknown>;
};

/** Customer/provider-facing: active methods only, in display order. */
export function useActivePaymentMethods() {
  return useQuery({
    queryKey: ["payment-methods", "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_methods")
        .select("*")
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PaymentMethodRow[];
    },
  });
}

// Ported from src/lib/db/provider-queries.ts
export function useRequirementsForService(serviceId: string | undefined) {
  return useQuery({
    enabled: !!serviceId,
    queryKey: ["service-requirements", serviceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_requirements")
        .select("*")
        .eq("service_id", serviceId!)
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });
}

// Ported from src/lib/db/student-education-queries.ts
export function useUpsertCustomerEducationProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: EducationProfileInput) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("auth required");
      const { data, error } = await supabase
        .from("customer_education_profiles")
        .upsert(
          {
            customer_id: user.id,
            education_curriculum_id: input.education_curriculum_id,
            education_level_id: input.education_level_id,
          },
          { onConflict: "customer_id" },
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer-education-profile"] });
    },
  });
}

export function useSaveStudentEducationProfile() {
  const qc = useQueryClient();
  const upsertSelf = useUpsertCustomerEducationProfile();
  const updateMember = useMutation({
    mutationFn: async (input: EducationProfileInput & { familyMemberId: string }) => {
      const { data, error } = await supabase
        .from("family_members")
        .update({
          education_curriculum_id: input.education_curriculum_id,
          education_level_id: input.education_level_id,
        })
        .eq("id", input.familyMemberId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["family-members"] });
    },
  });

  return {
    async save(args: {
      forWhom: string;
      education_curriculum_id: string | null;
      education_level_id: string | null;
    }) {
      if (args.forWhom === "myself") {
        return upsertSelf.mutateAsync({
          education_curriculum_id: args.education_curriculum_id,
          education_level_id: args.education_level_id,
        });
      }
      return updateMember.mutateAsync({
        familyMemberId: args.forWhom,
        education_curriculum_id: args.education_curriculum_id,
        education_level_id: args.education_level_id,
      });
    },
    isPending: upsertSelf.isPending || updateMember.isPending,
  };
}

// Ported from src/lib/db/cancellation-queries.ts
export function useCancelBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bookingId: string; reasonId: string; note?: string }) => {
      const { data, error } = await supabase.rpc("cancel_booking", {
        p_booking_id: input.bookingId,
        p_reason_id: input.reasonId,
        p_note: input.note || undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["booking", vars.bookingId] });
      qc.invalidateQueries({ queryKey: ["booking-cancellation", vars.bookingId] });
      qc.invalidateQueries({ queryKey: ["provider-booking", vars.bookingId] });
      qc.invalidateQueries({ queryKey: ["my-bookings"] });
      qc.invalidateQueries({ queryKey: ["provider-bookings"] });
      qc.invalidateQueries({ queryKey: ["admin", "bookings"] });
      qc.invalidateQueries({ queryKey: ["payment", vars.bookingId] });
    },
  });
}

export type PaymentStatus = "pending" | "pending_review" | "captured" | "rejected";
export type EducationProfileInput = {
  education_curriculum_id: string | null;
  education_level_id: string | null;
};

// Customer settings and validation RPCs from settings-queries.ts and promo-codes-queries.ts.
export function useBookingConfig<T>(key: string) {
  return useQuery({
    queryKey: ["settings", key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (error) throw error;
      return (data?.value ?? null) as T | null;
    },
  });
}
export async function validatePromoCode(code: string, serviceId: string, subtotal: number) {
  const { data, error } = await supabase.rpc("validate_promo_code", {
    p_code: code,
    p_service_id: serviceId,
    p_subtotal: subtotal,
  });
  if (error) throw error;
  return data as { ok: boolean; discount_amount: number; promo_code_id: string; reason?: string };
}
export type CancellationReason = {
  id: string;
  name_ar: string;
  name_en: string;
  applicable_statuses: string[];
  requires_note: boolean;
};
export function useCancellationReasons() {
  return useQuery({
    queryKey: ["cancellation-reasons", "customer"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cancellation_reasons")
        .select("*")
        .eq("is_active", true)
        .in("actor_type", ["customer", "any"])
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CancellationReason[];
    },
  });
}
