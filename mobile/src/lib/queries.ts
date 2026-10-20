// Queries ported from src/lib/db/queries.ts; table/RPC filters and ordering are preserved.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useSession } from "./session";
import { isQaCatalogSlug, isQaFixtureName, isQaCatalogService } from "@shared/catalog/qaCatalog";
import { isClosedBetaCategorySlug } from "@shared/catalog/closedBetaCategories";
import type { TeachingCapabilityOption } from "@shared/tutoring/teachingCapabilities";
import {
  addressesQueryKey,
  addressQueryKey,
  defaultAddressQueryKey,
  ADDRESSES_QUERY_ROOT,
  ADDRESS_QUERY_ROOT,
  DEFAULT_ADDRESS_QUERY_ROOT,
} from "@shared/db/address-query-keys";
const customerMarketplaceRefetchInterval = 5_000;
function useAuth() {
  const { session } = useSession();
  return { user: session?.user ?? null };
}
export function selectMarketplaceProviderRows<
  T extends {
    id: string;
    category_slug: string | null;
    service_slug: string | null;
    full_name: string | null;
  },
>(rows: T[], opts: { categorySlug?: string; limit?: number } = {}): T[] {
  const seenProviders = new Set<string>();
  return rows
    .filter((row) => {
      if (
        isQaCatalogSlug(row.category_slug, row.service_slug) ||
        isQaFixtureName(row.full_name) ||
        !isClosedBetaCategorySlug(row.category_slug) ||
        (opts.categorySlug && row.category_slug !== opts.categorySlug) ||
        seenProviders.has(row.id)
      ) {
        return false;
      }
      seenProviders.add(row.id);
      return true;
    })
    .slice(0, opts.limit ?? 50);
}

export function useMyProfile() {
  return useQuery({
    queryKey: ["my-profile"],
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useDefaultAddress() {
  const { user } = useAuth();
  return useQuery({
    enabled: !!user,
    queryKey: user ? defaultAddressQueryKey(user.id) : [DEFAULT_ADDRESS_QUERY_ROOT, "anonymous"],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("addresses")
        .select("*")
        .eq("user_id", user.id)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useAddresses() {
  const { user } = useAuth();
  return useQuery({
    enabled: !!user,
    queryKey: user ? addressesQueryKey(user.id) : [ADDRESSES_QUERY_ROOT, "anonymous"],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("addresses")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useDeleteAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("addresses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, _input, _ctx) => {
      qc.invalidateQueries({ queryKey: [ADDRESSES_QUERY_ROOT] });
      qc.invalidateQueries({ queryKey: [DEFAULT_ADDRESS_QUERY_ROOT] });
    },
  });
}

export function useSetDefaultAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("addresses").update({ is_default: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, _input, _ctx) => {
      qc.invalidateQueries({ queryKey: [ADDRESSES_QUERY_ROOT] });
      qc.invalidateQueries({ queryKey: [DEFAULT_ADDRESS_QUERY_ROOT] });
    },
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? [])
        .filter((row) => !isQaCatalogSlug(row.slug))
        .filter((row) => isClosedBetaCategorySlug(row.slug));
    },
  });
}

async function marketplaceRowsWithPackages(rows: MarketplaceRpcRow[]) {
  if (!rows.length) return [];
  const { data, error } = await supabase
    .from("services")
    .select("id, pricing_model, duration_min, fixed_start_time")
    .in("id", [...new Set(rows.map((row) => row.service_id))]);
  if (error) throw error;
  return rows.map((row) =>
    marketplaceRow(
      row,
      data?.find((service) => service.id === row.service_id),
    ),
  );
}

function marketplaceRow(
  row: MarketplaceRpcRow,
  packageService?: { pricing_model: string; duration_min: number; fixed_start_time: string | null },
) {
  return {
    id: row.id,
    bio_en: row.bio_en,
    bio_ar: row.bio_ar,
    hourly_rate: row.hourly_rate,
    years_experience: row.years_experience,
    languages: row.languages,
    city: row.city,
    is_top_pro: row.is_top_pro,
    is_verified: row.is_verified,
    response_time_min: row.response_time_min,
    profile: { full_name: row.full_name, avatar_url: row.avatar_url },
    ratings: { rating_avg: row.rating_avg, rating_count: row.rating_count },
    trust: { score: row.trust_score },
    services: [
      {
        status: "approved",
        service: {
          ...packageService,
          id: row.service_id,
          slug: row.service_slug,
          name_en: row.service_name_en,
          name_ar: row.service_name_ar,
          category: { slug: row.category_slug },
        },
      },
    ],
  };
}

async function safeProviderDetails(providerId: string) {
  const { data, error } = await supabase.rpc("marketplace_provider_details", {
    p_provider_id: providerId,
  });
  if (error) throw error;
  return data?.[0] ? (await marketplaceRowsWithPackages([data[0]]))[0] : null;
}

export function useProviders(
  opts: { categorySlug?: string; serviceId?: string; addressId?: string; limit?: number } = {},
) {
  return useQuery({
    queryKey: ["providers", opts],
    refetchInterval: customerMarketplaceRefetchInterval,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const args: { p_service_id?: string; p_address_id?: string } = {};
      if (opts.serviceId) args.p_service_id = opts.serviceId;
      if (opts.addressId) args.p_address_id = opts.addressId;
      const { data, error } = await supabase.rpc("search_marketplace_providers", args);
      if (error) throw error;
      return marketplaceRowsWithPackages(selectMarketplaceProviderRows(data ?? [], opts));
    },
  });
}

export function useProvider(id: string | undefined, addressId?: string) {
  return useQuery({
    enabled: !!id,
    queryKey: ["provider", id, addressId],
    refetchInterval: customerMarketplaceRefetchInterval,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const args: { p_provider_id: string; p_address_id?: string } = { p_provider_id: id! };
      if (addressId) args.p_address_id = addressId;
      const { data, error } = await supabase.rpc("marketplace_provider_details", args);
      if (error) throw error;
      return data?.[0] ? (await marketplaceRowsWithPackages([data[0]]))[0] : null;
    },
  });
}

export function useBookableServiceIds(providerId: string | undefined, addressId?: string) {
  return useQuery({
    enabled: !!providerId,
    // Signed-out visitors and providers get a permission error; don't retry it.
    retry: false,
    queryKey: ["bookable-services", providerId, addressId ?? null],
    queryFn: async () => {
      const args: { p_provider_id: string; p_address_id?: string } = { p_provider_id: providerId! };
      if (addressId) args.p_address_id = addressId;
      const { data, error } = await supabase.rpc("marketplace_provider_bookable_services", args);
      if (error) throw error;
      return new Map<string, number | null>(
        (data ?? []).map((row: { service_id: string; effective_price: number | null }) => [
          row.service_id,
          row.effective_price as number | null,
        ]),
      );
    },
  });
}

export function useMarketplaceServices(categorySlug?: string) {
  return useQuery({
    queryKey: ["marketplace-services", categorySlug ?? "all"],
    queryFn: async () => {
      let query = supabase
        .from("services")
        .select(
          "id,slug,name_en,name_ar,pricing_model,duration_min,fixed_start_time,category:categories!inner(slug,name_en,name_ar)",
        )
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("name_en");
      if (categorySlug) query = query.eq("category.slug", categorySlug);
      const { data, error } = await query.returns<MarketplaceService[]>();
      if (error) throw error;
      return (data ?? [])
        .filter((row) => !isQaCatalogService(row))
        .filter((row) => isClosedBetaCategorySlug(row.category?.slug));
    },
  });
}

export function useAvatarUrl(raw: string | null | undefined) {
  return useQuery({
    enabled: !!raw,
    // Re-sign automatically once the previous URL's 1-hour expiry is close,
    // rather than only on mount — this is the actual root cause fix for the
    // "sometimes shows old/broken image" glitch (Issue #4): a signed URL
    // rendered once and never refreshed will 403 after an hour with no
    // visible error, which reads as a random flicker.
    queryKey: ["avatar-url", raw],
    staleTime: 45 * 60 * 1000, // refetch a fresh signed URL after 45 min, before the 1h expiry hits
    queryFn: async () => {
      if (!raw) return null;
      if (raw.startsWith("http")) return raw;
      const { data, error } = await supabase.storage.from("avatars").createSignedUrl(raw, 60 * 60);
      if (error) throw error;
      return data?.signedUrl ?? null;
    },
  });
}

export function useMyBookings() {
  return useQuery({
    queryKey: ["my-bookings"],
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return [];
      const { data, error } = await supabase
        .from("bookings")
        .select(`*, service:services(*)`)
        .eq("customer_id", user.id)
        .order("start_at", { ascending: false });
      if (error) throw error;
      const providerIds = [...new Set((data ?? []).map((booking) => booking.provider_id))];
      const providers = new Map(
        await Promise.all(
          providerIds.map(async (id) => [id, await safeProviderDetails(id)] as const),
        ),
      );
      return (data ?? []).map((booking) => ({
        ...booking,
        provider: providers.get(booking.provider_id) ?? null,
      }));
    },
  });
}

export function useBooking(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ["booking", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select(`*, service:services(*), location:booking_locations(*)`)
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { ...data, provider: await safeProviderDetails(data.provider_id) };
    },
  });
}

export function useFavorites() {
  return useQuery({
    queryKey: ["favorites"],
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return [];
      const { data, error } = await supabase
        .from("favorites")
        .select("provider_id")
        .eq("user_id", user.id);
      if (error) throw error;
      const rows = await Promise.all(
        (data ?? []).map(async (favorite) => ({
          provider_id: favorite.provider_id,
          provider: await safeProviderDetails(favorite.provider_id),
        })),
      );
      return rows.filter((favorite) => favorite.provider !== null);
    },
  });
}

export function useFavoriteIds() {
  return useQuery({
    queryKey: ["favorite-ids"],
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return [] as string[];
      const { data, error } = await supabase
        .from("favorites")
        .select("provider_id")
        .eq("user_id", user.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.provider_id);
    },
  });
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ providerId, on }: { providerId: string; on: boolean }) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("auth required");
      if (on) {
        const { error } = await supabase
          .from("favorites")
          .insert({ user_id: user.id, provider_id: providerId });
        if (error && error.code !== "23505") throw error;
      } else {
        const { error } = await supabase
          .from("favorites")
          .delete()
          .eq("user_id", user.id)
          .eq("provider_id", providerId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["favorites"] });
      qc.invalidateQueries({ queryKey: ["favorite-ids"] });
    },
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .is("read_at", null);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["pro-notifications"] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["pro-notifications"] });
    },
  });
}

export function useSupportContact() {
  return useQuery({
    queryKey: ["support-contact"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "support_contact")
        .maybeSingle();
      if (error) throw error;
      return (data?.value as { phone?: string; whatsapp?: string; note?: string } | null) ?? null;
    },
  });
}

export function useProviderReviews(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["reviews", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reviews")
        .select("id, rating, comment, created_at")
        .eq("provider_id", providerId!)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useProviderServices(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["provider-services", providerId],
    queryFn: async () => {
      // `!inner` on the services join is required for `.eq('service.is_active', ...)`
      // below to actually filter — a plain left-embed ignores nested-column
      // filters. An inactive service must never be selectable for a new
      // booking, even if the provider's own offering of it is still approved.
      const { data, error } = await supabase
        .from("provider_services")
        .select(
          "price_override, status, service:services!inner(*, category:categories(slug, name_en, name_ar))",
        )
        .eq("provider_id", providerId!)
        .eq("status", "approved")
        .eq("service.is_active", true)
        .returns<ProviderService[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
}

// Source: src/lib/db/payment-queries.ts
export function useBookingPayment(bookingId: string | undefined) {
  return useQuery({
    enabled: !!bookingId,
    queryKey: ["payment", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("booking_id", bookingId!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
type DiscountType = "fixed" | "percentage";
export type FeaturedPromoCode = {
  id: string;
  code: string;
  description_en: string | null;
  description_ar: string | null;
  discount_type: DiscountType;
  discount_value: number;
  minimum_booking_amount: number;
  expires_at: string | null;
};

export function useFeaturedPromoCodes() {
  return useQuery({
    queryKey: ["featured-promo-codes"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_active_featured_promo_codes");
      if (error) throw error;
      return (data ?? []) as FeaturedPromoCode[];
    },
  });
}
export type PromoRedemptionRow = {
  id: string;
  promo_code_id: string;
  booking_id: string;
  discount_amount: number;
  redeemed_at: string;
  bookings: {
    promo_code: string | null;
    promo_description_en: string | null;
    promo_description_ar: string | null;
  } | null;
};

export function useMyPromoRedemptions() {
  return useQuery({
    queryKey: ["my-promo-redemptions"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("promo_code_redemptions")
        .select(
          "id, promo_code_id, booking_id, discount_amount, redeemed_at, bookings(promo_code, promo_description_en, promo_description_ar)",
        )
        .eq("customer_id", user.id)
        .order("redeemed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PromoRedemptionRow[];
    },
  });
}
type PlatformContentKey = "terms" | "privacy";
export function usePlatformContent(key: PlatformContentKey) {
  return useQuery({
    queryKey: ["settings", "content", key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("value")
        .eq("key", `content_${key}`)
        .maybeSingle();
      if (error) throw error;
      const value = data?.value as { body_en?: string; body_ar?: string } | null;
      return { body_en: value?.body_en ?? "", body_ar: value?.body_ar ?? "" };
    },
  });
}
// Source: src/lib/db/family-members-queries.ts (removal is soft, never DELETE).
export type Relationship =
  "spouse" | "son" | "daughter" | "father" | "mother" | "sibling" | "grandparent" | "other";

export type FamilyMemberInput = {
  full_name: string;
  relationship: Relationship;
  relationship_other?: string | null;
  date_of_birth: string;
  gender?: "male" | "female" | "other" | null;
  phone?: string | null;
  allergies?: string | null;
  medical_notes?: string | null;
  access_notes?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  education_curriculum_id?: string | null;
  education_level_id?: string | null;
};

function toFamilyMemberRow(input: FamilyMemberInput) {
  return {
    full_name: input.full_name.trim(),
    relationship: input.relationship,
    relationship_other:
      input.relationship === "other" ? input.relationship_other?.trim() || null : null,
    date_of_birth: input.date_of_birth,
    gender: input.gender ?? null,
    phone: input.phone ?? null,
    allergies: input.allergies ?? null,
    medical_notes: input.medical_notes ?? null,
    access_notes: input.access_notes ?? null,
    emergency_contact_name: input.emergency_contact_name ?? null,
    emergency_contact_phone: input.emergency_contact_phone ?? null,
    education_curriculum_id: input.education_curriculum_id ?? null,
    education_level_id: input.education_level_id ?? null,
  };
}

/** All of the current customer's family members, most recent first. */
export function useFamilyMembers() {
  return useQuery({
    queryKey: ["family-members"],
    queryFn: async ({ signal }) => {
      if (signal.aborted) return [];
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return [];
      const { data, error } = await supabase
        .from("family_members")
        .select("*")
        .eq("customer_id", user.id)
        .order("created_at", { ascending: false })
        .abortSignal(signal);
      if (error) {
        if (signal.aborted) return [];
        throw error;
      }
      return data ?? [];
    },
  });
}

/** Active members only — the set selectable when booking. */
export function useActiveFamilyMembers() {
  return useQuery({
    queryKey: ["family-members", "active"],
    queryFn: async ({ signal }) => {
      if (signal.aborted) return [];
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return [];
      const { data, error } = await supabase
        .from("family_members")
        .select("*")
        .eq("customer_id", user.id)
        .eq("is_active", true)
        .order("full_name", { ascending: true })
        .abortSignal(signal);
      if (error) {
        if (signal.aborted) return [];
        throw error;
      }
      return data ?? [];
    },
  });
}

export function useFamilyMember(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ["family-member", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("family_members")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

function invalidateFamilyMembers(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["family-members"] });
}

export function useCreateFamilyMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FamilyMemberInput) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("auth required");
      const { data, error } = await supabase
        .from("family_members")
        .insert({ ...toFamilyMemberRow(input), customer_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateFamilyMembers(qc),
  });
}

export function useUpdateFamilyMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FamilyMemberInput & { id: string }) => {
      const { data, error } = await supabase
        .from("family_members")
        .update(toFamilyMemberRow(input))
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      invalidateFamilyMembers(qc);
      qc.invalidateQueries({ queryKey: ["family-member", vars.id] });
    },
  });
}

/** Soft-deactivate — never a hard delete, so historical bookings stay intact and readable. */
export function useDeactivateFamilyMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("family_members")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidateFamilyMembers(qc),
  });
}

export type FamilyMemberRow = FamilyMemberInput & {
  id: string;
  is_active: boolean;
  created_at: string;
};

// Source: src/lib/db/teaching-queries.ts
const TAXONOMY_SELECT = "id, code, name_en, name_ar, is_active, sort_order";
const SUBJECT_SELECT = `${TAXONOMY_SELECT}, max_session_duration_min`;

export type TeachingCurriculumRow = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  is_active: boolean;
  sort_order: number;
};

export type TeachingLevelRow = TeachingCurriculumRow;

export type TeachingSubjectRow = TeachingCurriculumRow & {
  max_session_duration_min: number;
};

export type TeachingSubjectServiceRow = {
  subject_id: string;
  service_id: string;
};

export type ProviderTeachingCapabilityRow = {
  id: string;
  provider_id: string;
  service_id: string;
  subject_id: string;
  curriculum_id: string;
  level_id: string;
  session_duration_min: number;
  session_price: number;
  status: "pending" | "approved" | "rejected" | "suspended";
  submitted_at: string;
  subject?: {
    code: string;
    name_en: string;
    name_ar: string;
    max_session_duration_min: number;
  } | null;
  curriculum?: { code: string; name_en: string; name_ar: string } | null;
  level?: { code: string; name_en: string; name_ar: string } | null;
};

export type AdminTeachingCapabilityRow = ProviderTeachingCapabilityRow & {
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  subject_code: string;
  subject_name_en: string;
  subject_name_ar: string;
  curriculum_code: string;
  curriculum_name_en: string;
  curriculum_name_ar: string;
  level_code: string;
  level_name_en: string;
  level_name_ar: string;
};

const CAPABILITY_SELECT =
  "id, provider_id, service_id, subject_id, curriculum_id, level_id, session_duration_min, session_price, status, submitted_at, subject:teaching_subjects(code, name_en, name_ar, max_session_duration_min), curriculum:teaching_curricula(code, name_en, name_ar), level:teaching_levels(code, name_en, name_ar)";

export function mapCapabilityOption(row: ProviderTeachingCapabilityRow): TeachingCapabilityOption {
  return {
    id: row.id,
    providerId: row.provider_id,
    serviceId: row.service_id,
    curriculumId: row.curriculum_id,
    levelId: row.level_id,
    subjectCode: row.subject?.code ?? "",
    subjectNameEn: row.subject?.name_en ?? "",
    subjectNameAr: row.subject?.name_ar ?? "",
    curriculumCode: row.curriculum?.code ?? "",
    curriculumNameEn: row.curriculum?.name_en ?? "",
    curriculumNameAr: row.curriculum?.name_ar ?? "",
    levelCode: row.level?.code ?? "",
    levelNameEn: row.level?.name_en ?? "",
    levelNameAr: row.level?.name_ar ?? "",
    durationMin: row.session_duration_min,
    price: row.session_price,
    status: row.status,
    maxSessionDurationMin: row.subject?.max_session_duration_min ?? 120,
  };
}

export function useTeachingCurricula(includeInactive = false) {
  return useQuery({
    queryKey: ["teaching-curricula", includeInactive],
    queryFn: async () => {
      let query = supabase
        .from("teaching_curricula")
        .select(TAXONOMY_SELECT)
        .order("sort_order", { ascending: true });
      if (!includeInactive) query = query.eq("is_active", true);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as TeachingCurriculumRow[];
    },
  });
}

export function useTeachingLevels(includeInactive = false) {
  return useQuery({
    queryKey: ["teaching-levels", includeInactive],
    queryFn: async () => {
      let query = supabase
        .from("teaching_levels")
        .select(TAXONOMY_SELECT)
        .order("sort_order", { ascending: true });
      if (!includeInactive) query = query.eq("is_active", true);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as TeachingLevelRow[];
    },
  });
}

export function useApprovedTeachingCapabilities(
  providerId: string | undefined,
  serviceId?: string,
) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["approved-teaching-capabilities", providerId, serviceId ?? null],
    queryFn: async () => {
      let query = supabase
        .from("provider_teaching_capabilities")
        .select(CAPABILITY_SELECT)
        .eq("provider_id", providerId!)
        .eq("status", "approved");
      if (serviceId) query = query.eq("service_id", serviceId);
      const { data, error } = await query;
      if (error) throw error;
      return ((data ?? []) as unknown as ProviderTeachingCapabilityRow[]).map(mapCapabilityOption);
    },
  });
}
export function useApprovedTeachingCapabilitiesForProviders(providerIds: string[]) {
  const ids = [...providerIds].sort();
  return useQuery({
    enabled: ids.length > 0,
    queryKey: ["approved-teaching-capabilities-many", ids],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_teaching_capabilities")
        .select(CAPABILITY_SELECT)
        .eq("status", "approved")
        .in("provider_id", ids);
      if (error) throw error;
      return ((data ?? []) as unknown as ProviderTeachingCapabilityRow[]).map(mapCapabilityOption);
    },
  });
}
// Source: src/lib/db/booking-parties.ts
export type BookingParty = {
  booking_id: string;
  viewer_role: string;
  other_user_id: string;
  other_name: string | null;
  other_avatar_url: string | null;
  /** Only returned while the booking is active (confirmed .. completion_requested). */
  other_phone: string | null;
  area: string | null;
  zone_name_en: string | null;
  zone_name_ar: string | null;
  member_first_name: string | null;
  member_age_years: number | null;
};

const RPC_BATCH = 200;

/**
 * The other party of each booking (name, avatar, and the phone only while the
 * booking is active). `profiles` is self-only under RLS, so a plain join
 * returns null; `booking_party_profiles` checks that the caller is a party to
 * every booking. Ids are sent in batches the RPC accepts.
 */
export async function fetchBookingParties(
  bookingIds: string[],
): Promise<Map<string, BookingParty>> {
  const ids = [...new Set(bookingIds.filter(Boolean))];
  const parties = new Map<string, BookingParty>();
  for (let i = 0; i < ids.length; i += RPC_BATCH) {
    const { data, error } = await supabase.rpc("booking_party_profiles", {
      p_booking_ids: ids.slice(i, i + RPC_BATCH),
    });
    if (error) throw error;
    for (const row of data ?? []) parties.set(row.booking_id, row as BookingParty);
  }
  return parties;
}

export function useBookingParties(bookingIds: (string | null | undefined)[]) {
  const ids = [...new Set(bookingIds.filter((id): id is string => !!id))].sort();
  return useQuery({
    enabled: ids.length > 0,
    queryKey: ["booking-parties", ids],
    queryFn: () => fetchBookingParties(ids),
  });
}

export function useBookingParty(bookingId: string | null | undefined) {
  const q = useBookingParties([bookingId]);
  return { ...q, party: bookingId ? (q.data?.get(bookingId) ?? null) : null };
}

export type Provider = NonNullable<Awaited<ReturnType<typeof safeProviderDetails>>>;

export type MarketplaceService = {
  id: string;
  slug: string;
  name_en: string;
  name_ar: string;
  pricing_model: string;
  duration_min: number;
  fixed_start_time: string | null;
  category: { slug: string; name_en: string; name_ar: string } | null;
};

type MarketplaceRpcRow = {
  id: string;
  bio_en: string | null;
  bio_ar: string | null;
  hourly_rate: number | null;
  years_experience: number | null;
  languages: string[] | null;
  city: string | null;
  is_top_pro: boolean;
  is_verified: boolean;
  response_time_min: number | null;
  full_name: string | null;
  avatar_url: string | null;
  rating_avg: number | null;
  rating_count: number;
  trust_score: number | null;
  service_id: string;
  service_slug: string;
  service_name_en: string;
  service_name_ar: string;
  category_slug: string;
};
type ProviderService = {
  price_override: number | null;
  status: string;
  service: MarketplaceService;
};

// Source: src/lib/db/student-education-queries.ts
export function useCustomerEducationProfile() {
  return useQuery({
    queryKey: ["customer-education-profile"],
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return null;
      const { data, error } = await supabase
        .from("customer_education_profiles")
        .select("*")
        .eq("customer_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
