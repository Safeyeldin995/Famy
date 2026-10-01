/**
 * Platform settings data layer — generic key/value rows on the existing
 * `settings` table. No new tables. RLS: settings_public_read
 * (anon+authenticated) / settings_admin_write (admin only) already exist
 * and are reused as-is.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { commissionPercentEqual, parseCommissionPercent } from '@/lib/billing/commissionPercent';

export type BillingSettings = {
  vat_percent: number;
  platform_fee: number;
  /** Null means the admin has not set a Famy commission rate. Never invent a number. */
  commission_percent: number | null;
};

// Same hardcoded values the booking flow used before this change — kept only
// as the fallback when no `billing` settings row exists yet, per explicit
// backward-compatibility requirement. Commission has no numeric fallback.
export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  vat_percent: 14,
  platform_fee: 25,
  commission_percent: null,
};

function readCommissionPercent(value: Partial<BillingSettings> | null | undefined): number | null {
  const parsed = parseCommissionPercent(value?.commission_percent ?? null);
  return parsed.ok ? parsed.value : null;
}

export function useBillingSettings() {
  return useQuery({
    queryKey: ['settings', 'billing'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'billing')
        .maybeSingle();
      if (error) throw error;
      const value = data?.value as Partial<BillingSettings> | null;
      return {
        vat_percent: value?.vat_percent ?? DEFAULT_BILLING_SETTINGS.vat_percent,
        platform_fee: value?.platform_fee ?? DEFAULT_BILLING_SETTINGS.platform_fee,
        commission_percent: readCommissionPercent(value),
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
        throw new Error('Commission percent is invalid.');
      }
      const payload: BillingSettings = {
        vat_percent: value.vat_percent,
        platform_fee: value.platform_fee,
        commission_percent: parsedCommission.value,
      };
      const { data, error } = await supabase
        .from('settings')
        .upsert({ key: 'billing', value: payload }, { onConflict: 'key' })
        .select('value')
        .single();
      if (error) throw error;
      const stored = data.value as BillingSettings;
      if (
        Number(stored.vat_percent) !== payload.vat_percent ||
        Number(stored.platform_fee) !== payload.platform_fee ||
        !commissionPercentEqual(readCommissionPercent(stored), payload.commission_percent)
      ) {
        throw new Error('Billing settings did not persist.');
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'billing'] }),
  });
}

export function useServiceAreasSettings() {
  return useQuery({
    queryKey: ['settings', 'service_areas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'service_areas')
        .maybeSingle();
      if (error) throw error;
      const value = data?.value as { areas?: { name: string; enabled: boolean }[] } | null;
      // Fallback matches the two hardcoded constants already duplicated in
      // setup.tsx and pro.onboarding.tsx, so behavior is unchanged until an
      // admin explicitly edits this setting.
      return value?.areas ?? [
        { name: 'Sheikh Zayed', enabled: true },
        { name: '6th of October', enabled: true },
      ];
    },
  });
}

export function useUpdateServiceAreasSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (areas: { name: string; enabled: boolean }[]) => {
      const { data, error } = await supabase
        .from('settings')
        .upsert({ key: 'service_areas', value: { areas } }, { onConflict: 'key' })
        .select('value')
        .single();
      if (error) throw error;
      const stored = (data.value as { areas?: { name: string; enabled: boolean }[] }).areas ?? [];
      if (JSON.stringify(stored) !== JSON.stringify(areas)) throw new Error('Service area settings did not persist.');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'service_areas'] }),
  });
}

export type PlatformContentKey = 'terms' | 'privacy' | 'about' | 'contact';

export function usePlatformContent(key: PlatformContentKey) {
  return useQuery({
    queryKey: ['settings', 'content', key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', `content_${key}`)
        .maybeSingle();
      if (error) throw error;
      const value = data?.value as { body_en?: string; body_ar?: string } | null;
      return { body_en: value?.body_en ?? '', body_ar: value?.body_ar ?? '' };
    },
  });
}

export function useUpdatePlatformContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, body_en, body_ar }: { key: PlatformContentKey; body_en: string; body_ar: string }) => {
      const { data, error } = await supabase
        .from('settings')
        .upsert({ key: `content_${key}`, value: { body_en, body_ar } }, { onConflict: 'key' })
        .select('value')
        .single();
      if (error) throw error;
      const stored = data.value as { body_en?: string; body_ar?: string };
      if (stored.body_en !== body_en || stored.body_ar !== body_ar) throw new Error('Platform content did not persist.');
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['settings', 'content', vars.key] }),
  });
}
