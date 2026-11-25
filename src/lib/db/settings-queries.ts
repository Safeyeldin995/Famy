/**
 * Platform settings data layer — generic key/value rows on the existing
 * `settings` table. No new tables. RLS: settings_public_read
 * (anon+authenticated) / settings_admin_write (admin only) already exist
 * and are reused as-is.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Json } from "@/integrations/supabase/types";
import {
  parseAppReleaseSettings,
  validateAppReleaseSettings,
  type AppReleaseSettings,
} from "@/lib/appRelease";
import { supabase } from "@/integrations/supabase/client";
import {
  parseBookingExpirySettings,
  type BookingExpirySettings,
} from "@/lib/booking/pending-expiry";
import { commissionPercentEqual, parseCommissionPercent } from "@/lib/billing/commissionPercent";
import { validateStoreLinksSettings, type StoreLinksSettings } from "@/lib/storeLinks";

export type BillingSettings = {
  vat_percent: number;
  platform_fee: number;
  /** Null means the admin has not set a Famy commission rate. Never invent a number. */
  commission_percent: number | null;
  commission_percent_online: number | null;
};

// Same hardcoded values the booking flow used before this change — kept only
// as the fallback when no `billing` settings row exists yet, per explicit
// backward-compatibility requirement. Commission has no numeric fallback.
export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  vat_percent: 14,
  platform_fee: 25,
  commission_percent: null,
  commission_percent_online: null,
};

function readCommissionPercent(value: Partial<BillingSettings> | null | undefined): number | null {
  const parsed = parseCommissionPercent(value?.commission_percent ?? null);
  return parsed.ok ? parsed.value : null;
}

export function useBillingSettings() {
  return useQuery({
    queryKey: ["settings", "billing"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "billing")
        .maybeSingle();
      if (error) throw error;
      const value = data?.value as Partial<BillingSettings> | null;
      return {
        vat_percent: value?.vat_percent ?? DEFAULT_BILLING_SETTINGS.vat_percent,
        platform_fee: value?.platform_fee ?? DEFAULT_BILLING_SETTINGS.platform_fee,
        commission_percent: readCommissionPercent(value),
        commission_percent_online: (() => {
          const parsed = parseCommissionPercent(value?.commission_percent_online ?? null);
          return parsed.ok ? parsed.value : null;
        })(),
      } satisfies BillingSettings;
    },
  });
}

export function useUpdateBillingSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (value: BillingSettings) => {
      const parsedCommission = parseCommissionPercent(value.commission_percent);
      if (!parsedCommission.ok) {
        throw new Error("Commission percent is invalid.");
      }
      const parsedOnline = parseCommissionPercent(value.commission_percent_online);
      if (!parsedOnline.ok) {
        throw new Error("Online commission percent is invalid.");
      }
      const payload: BillingSettings = {
        vat_percent: value.vat_percent,
        platform_fee: value.platform_fee,
        commission_percent: parsedCommission.value,
        commission_percent_online: parsedOnline.value,
      };
      const { data, error } = await supabase
        .from("settings")
        .upsert({ key: "billing", value: payload }, { onConflict: "key" })
        .select("value")
        .single();
      if (error) throw error;
      const stored = data.value as BillingSettings;
      if (
        Number(stored.vat_percent) !== payload.vat_percent ||
        Number(stored.platform_fee) !== payload.platform_fee ||
        !commissionPercentEqual(readCommissionPercent(stored), payload.commission_percent) ||
        !commissionPercentEqual(
          readCommissionPercent({
            commission_percent: stored.commission_percent_online ?? null,
          }),
          payload.commission_percent_online,
        )
      ) {
        throw new Error("Billing settings did not persist.");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "billing"] }),
  });
}

export function useServiceAreasSettings() {
  return useQuery({
    queryKey: ["settings", "service_areas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "service_areas")
        .maybeSingle();
      if (error) throw error;
      const value = data?.value as { areas?: { name: string; enabled: boolean }[] } | null;
      // Fallback matches the two hardcoded constants already duplicated in
      // setup.tsx and pro.onboarding.tsx, so behavior is unchanged until an
      // admin explicitly edits this setting.
      return (
        value?.areas ?? [
          { name: "Sheikh Zayed", enabled: true },
          { name: "6th of October", enabled: true },
        ]
      );
    },
  });
}

export function useUpdateServiceAreasSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (areas: { name: string; enabled: boolean }[]) => {
      const { data, error } = await supabase
        .from("settings")
        .upsert({ key: "service_areas", value: { areas } }, { onConflict: "key" })
        .select("value")
        .single();
      if (error) throw error;
      const stored = (data.value as { areas?: { name: string; enabled: boolean }[] }).areas ?? [];
      if (JSON.stringify(stored) !== JSON.stringify(areas))
        throw new Error("Service area settings did not persist.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "service_areas"] }),
  });
}

export type PlatformContentKey = "terms" | "privacy" | "about" | "contact";

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

export function useUpdatePlatformContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      key,
      body_en,
      body_ar,
    }: {
      key: PlatformContentKey;
      body_en: string;
      body_ar: string;
    }) => {
      const { data, error } = await supabase
        .from("settings")
        .upsert({ key: `content_${key}`, value: { body_en, body_ar } }, { onConflict: "key" })
        .select("value")
        .single();
      if (error) throw error;
      const stored = data.value as { body_en?: string; body_ar?: string };
      if (stored.body_en !== body_en || stored.body_ar !== body_ar)
        throw new Error("Platform content did not persist.");
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["settings", "content", vars.key] }),
  });
}

export function useBookingExpirySettings() {
  return useQuery({
    queryKey: ["settings", "booking_expiry"],
    queryFn: async (): Promise<BookingExpirySettings> => {
      const { data, error } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "booking_expiry")
        .maybeSingle();
      if (error) throw error;
      return parseBookingExpirySettings(data?.value);
    },
  });
}

export type ProviderSettlementSettings = {
  cash_debt_limit: number;
  cash_debt_warn_percent: number;
  settlement_weekday: number;
};

export function parseProviderSettlementSettings(
  value: Record<string, unknown> | null | undefined,
): ProviderSettlementSettings {
  const limit = Number(value?.cash_debt_limit ?? 1000);
  const warn = Number(value?.cash_debt_warn_percent ?? 80);
  const weekday = Number(value?.settlement_weekday ?? 0);
  return {
    cash_debt_limit: Number.isFinite(limit) && limit > 0 ? limit : 1000,
    cash_debt_warn_percent: Number.isFinite(warn) && warn > 0 && warn <= 100 ? warn : 80,
    settlement_weekday: Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : 0,
  };
}

export function useProviderSettlementSettingsAdmin() {
  return useQuery({
    queryKey: ["settings", "provider_settlement", "admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "provider_settlement")
        .maybeSingle();
      if (error) throw error;
      return parseProviderSettlementSettings((data?.value as Record<string, unknown>) ?? {});
    },
  });
}

export function useUpdateProviderSettlementSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: ProviderSettlementSettings) => {
      const { data: current, error: readErr } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "provider_settlement")
        .maybeSingle();
      if (readErr) throw readErr;
      const existing = (current?.value as Record<string, unknown>) ?? {};
      const merged = {
        ...existing,
        cash_debt_limit: patch.cash_debt_limit,
        cash_debt_warn_percent: patch.cash_debt_warn_percent,
        settlement_weekday: patch.settlement_weekday,
      };
      const { data, error } = await supabase
        .from("settings")
        .upsert({ key: "provider_settlement", value: merged }, { onConflict: "key" })
        .select("value")
        .single();
      if (error) throw error;
      const stored = parseProviderSettlementSettings(data.value as Record<string, unknown>);
      if (
        stored.cash_debt_limit !== patch.cash_debt_limit ||
        stored.cash_debt_warn_percent !== patch.cash_debt_warn_percent ||
        stored.settlement_weekday !== patch.settlement_weekday
      ) {
        throw new Error("Provider settlement settings did not persist.");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings", "provider_settlement"] });
    },
  });
}

export function useUpdateBookingExpirySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (value: BookingExpirySettings) => {
      const { data, error } = await supabase
        .from("settings")
        .upsert({ key: "booking_expiry", value }, { onConflict: "key" })
        .select("value")
        .single();
      if (error) throw error;
      const stored = parseBookingExpirySettings(data.value);
      if (
        stored.pending_ttl_hours !== value.pending_ttl_hours ||
        stored.min_hours_before_start !== value.min_hours_before_start ||
        stored.auto_complete_hours !== value.auto_complete_hours
      ) {
        throw new Error("Booking expiry settings did not persist.");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "booking_expiry"] }),
  });
}

export type CancellationPolicy = {
  fee_mode: "fixed" | "percent";
  fee_value: number;
  free_cancel_hours: number;
};

/** Same defaults and bounds as the database's cancellation_policy(). */
export function parseCancellationPolicy(
  value: Record<string, unknown> | null | undefined,
): CancellationPolicy {
  const mode = value?.fee_mode === "percent" ? "percent" : "fixed";
  const fee = Number(value?.fee_value ?? 0);
  const hours = Number(value?.free_cancel_hours ?? 2);
  return {
    fee_mode: mode,
    fee_value:
      Number.isFinite(fee) && fee > 0 ? (mode === "percent" ? Math.min(fee, 100) : fee) : 0,
    free_cancel_hours: Number.isFinite(hours) && hours >= 0 ? hours : 2,
  };
}

export type CancellationServiceMode = "in_person" | "online";
export type CancellationPolicyModes = Record<CancellationServiceMode, CancellationPolicy>;

const LEGACY_FLAT_POLICY_KEYS = ["fee_mode", "fee_value", "free_cancel_hours"] as const;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Reads settings.cancellation_policy the same way the database's
 * cancellation_policy_for(mode) does:
 * - in_person: root.in_person, else the legacy flat root;
 * - online: root.online, else root.in_person, else the legacy flat root.
 */
export function parseCancellationPolicySettings(value: unknown): CancellationPolicyModes {
  const root = asObject(value) ?? {};
  const inPerson = asObject(root.in_person);
  const online = asObject(root.online);
  return {
    in_person: parseCancellationPolicy(inPerson ?? root),
    online: parseCancellationPolicy(online ?? inPerson ?? root),
  };
}

/**
 * The value to store: always the per-mode shape. Unknown keys already in the
 * stored object are kept; legacy flat rule keys are dropped because the
 * per-mode entries now replace them.
 */
export function serializeCancellationPolicySettings(
  existing: unknown,
  modes: CancellationPolicyModes,
): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...(asObject(existing) ?? {}) };
  for (const key of LEGACY_FLAT_POLICY_KEYS) delete rest[key];
  const keep = (mode: CancellationServiceMode) => ({
    ...(asObject(rest[mode]) ?? {}),
    fee_mode: modes[mode].fee_mode,
    fee_value: modes[mode].fee_value,
    free_cancel_hours: modes[mode].free_cancel_hours,
  });
  return { ...rest, in_person: keep("in_person"), online: keep("online") };
}

function samePolicy(a: CancellationPolicy, b: CancellationPolicy): boolean {
  return (
    a.fee_mode === b.fee_mode &&
    a.fee_value === b.fee_value &&
    a.free_cancel_hours === b.free_cancel_hours
  );
}

export function useCancellationPolicyAdmin() {
  return useQuery({
    queryKey: ["settings", "cancellation_policy"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "cancellation_policy")
        .maybeSingle();
      if (error) throw error;
      return parseCancellationPolicySettings(data?.value ?? {});
    },
  });
}

export function useUpdateCancellationPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (modes: CancellationPolicyModes) => {
      // Read the current value first so keys we don't manage are kept.
      const { data: current, error: readError } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "cancellation_policy")
        .maybeSingle();
      if (readError) throw readError;
      const value = serializeCancellationPolicySettings(current?.value ?? {}, modes);
      const { data, error } = await supabase
        .from("settings")
        .upsert({ key: "cancellation_policy", value: value as Json }, { onConflict: "key" })
        .select("value")
        .single();
      if (error) throw error;
      const stored = parseCancellationPolicySettings(data.value);
      if (
        !samePolicy(stored.in_person, modes.in_person) ||
        !samePolicy(stored.online, modes.online)
      ) {
        throw new Error("Cancellation policy did not persist.");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "cancellation_policy"] }),
  });
}

/** What the customer would pay to cancel now (or what was charged). */
export type ReleaseFeatureSettings = {
  online_lessons_enabled: boolean;
};

export const DEFAULT_RELEASE_FEATURES: ReleaseFeatureSettings = {
  online_lessons_enabled: false,
};

export type { StoreLinksSettings };

export const DEFAULT_STORE_LINKS: StoreLinksSettings = {
  play_url: "",
  app_store_url: "",
};

export function parseStoreLinksSettings(
  value: Record<string, unknown> | null | undefined,
): StoreLinksSettings {
  const play = typeof value?.play_url === "string" ? value.play_url.trim() : "";
  const apple = typeof value?.app_store_url === "string" ? value.app_store_url.trim() : "";
  return { play_url: play, app_store_url: apple };
}

export function useStoreLinksSettings() {
  return useQuery({
    queryKey: ["settings", "store_links"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "store_links")
        .maybeSingle();
      if (error) throw error;
      return parseStoreLinksSettings((data?.value as Record<string, unknown>) ?? {});
    },
  });
}

export function useStoreLinksSettingsAdmin() {
  return useStoreLinksSettings();
}

export function useUpdateStoreLinksSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (value: StoreLinksSettings) => {
      if (validateStoreLinksSettings(value).length > 0) {
        throw new Error("Store links are invalid.");
      }
      const normalized = parseStoreLinksSettings(value);
      const { data, error } = await supabase
        .from("settings")
        .upsert({ key: "store_links", value: normalized }, { onConflict: "key" })
        .select("value")
        .single();
      if (error) throw error;
      const stored = parseStoreLinksSettings(data.value as Record<string, unknown>);
      if (JSON.stringify(stored) !== JSON.stringify(normalized)) {
        throw new Error("Store links did not persist.");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "store_links"] }),
  });
}

export function parseReleaseFeatureSettings(
  value: Record<string, unknown> | null | undefined,
): ReleaseFeatureSettings {
  return {
    online_lessons_enabled: value?.online_lessons_enabled === true,
  };
}

export function useReleaseFeatureSettingsAdmin() {
  return useQuery({
    queryKey: ["settings", "release_features"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "release_features")
        .maybeSingle();
      if (error) throw error;
      return parseReleaseFeatureSettings((data?.value as Record<string, unknown>) ?? {});
    },
  });
}

export function useUpdateReleaseFeatureSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (value: ReleaseFeatureSettings) => {
      const { data, error } = await supabase
        .from("settings")
        .upsert({ key: "release_features", value }, { onConflict: "key" })
        .select("value")
        .single();
      if (error) throw error;
      const stored = parseReleaseFeatureSettings(data.value as Record<string, unknown>);
      if (stored.online_lessons_enabled !== value.online_lessons_enabled) {
        throw new Error("Release feature settings did not persist.");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "release_features"] }),
  });
}

export function useAppReleaseSettingsAdmin() {
  return useQuery({
    queryKey: ["settings", "app_release"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "app_release")
        .maybeSingle();
      if (error) throw error;
      return parseAppReleaseSettings((data?.value as Record<string, unknown>) ?? {});
    },
  });
}

export function useUpdateAppReleaseSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (value: AppReleaseSettings) => {
      if (validateAppReleaseSettings(value).length > 0) {
        throw new Error("App release settings are invalid.");
      }
      const { data, error } = await supabase
        .from("settings")
        .upsert({ key: "app_release", value }, { onConflict: "key" })
        .select("value")
        .single();
      if (error) throw error;
      const stored = parseAppReleaseSettings(data.value as Record<string, unknown>);
      if (JSON.stringify(stored) !== JSON.stringify(parseAppReleaseSettings(value))) {
        throw new Error("App release settings did not persist.");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "app_release"] }),
  });
}

export function useBookingCancellationFee(bookingId: string | undefined, enabled = true) {
  return useQuery({
    enabled: !!bookingId && enabled,
    queryKey: ["booking-cancellation-fee", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("booking_cancellation_fee", {
        p_booking_id: bookingId!,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
  });
}
