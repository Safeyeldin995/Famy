import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type GrowthDay = {
  day: string;
  new_customers: number;
  new_providers: number;
  bookings_created: number;
  bookings_completed: number;
  bookings_cancelled: number;
  revenue: number;
  platform_share: number;
};

export type AdminGrowthMetrics = {
  days: number;
  from: string;
  daily: GrowthDay[];
  totals: {
    customers_total: number;
    providers_total: number;
    providers_approved: number;
    bookings_total: number;
    rating_avg: number | null;
    rating_count: number;
    repeat_customers: number;
    customers_with_booking: number;
  };
  provider_funnel: Record<string, number>;
  top_services: { service_id: string; name_ar: string; name_en: string; bookings: number }[];
  app: {
    customers: number;
    providers: number;
    android: number;
    ios: number;
    active_7d: number;
    active_30d: number;
  };
};

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function parseAdminGrowthMetrics(raw: unknown): AdminGrowthMetrics {
  const r = (raw ?? {}) as Record<string, any>;
  const totals = (r.totals ?? {}) as Record<string, unknown>;
  const app = (r.app ?? {}) as Record<string, unknown>;
  const funnel: Record<string, number> = {};
  for (const [k, v] of Object.entries((r.provider_funnel ?? {}) as Record<string, unknown>))
    funnel[k] = num(v);
  return {
    days: num(r.days),
    from: String(r.from ?? ""),
    daily: (Array.isArray(r.daily) ? r.daily : []).map((d: Record<string, unknown>) => ({
      day: String(d.day ?? ""),
      new_customers: num(d.new_customers),
      new_providers: num(d.new_providers),
      bookings_created: num(d.bookings_created),
      bookings_completed: num(d.bookings_completed),
      bookings_cancelled: num(d.bookings_cancelled),
      revenue: num(d.revenue),
      platform_share: num(d.platform_share),
    })),
    totals: {
      customers_total: num(totals.customers_total),
      providers_total: num(totals.providers_total),
      providers_approved: num(totals.providers_approved),
      bookings_total: num(totals.bookings_total),
      rating_avg: totals.rating_avg == null ? null : num(totals.rating_avg),
      rating_count: num(totals.rating_count),
      repeat_customers: num(totals.repeat_customers),
      customers_with_booking: num(totals.customers_with_booking),
    },
    provider_funnel: funnel,
    top_services: (Array.isArray(r.top_services) ? r.top_services : []).map(
      (s: Record<string, unknown>) => ({
        service_id: String(s.service_id ?? ""),
        name_ar: String(s.name_ar ?? ""),
        name_en: String(s.name_en ?? ""),
        bookings: num(s.bookings),
      }),
    ),
    app: {
      customers: num(app.customers),
      providers: num(app.providers),
      android: num(app.android),
      ios: num(app.ios),
      active_7d: num(app.active_7d),
      active_30d: num(app.active_30d),
    },
  };
}

export function useAdminGrowthMetrics(days: number) {
  return useQuery({
    queryKey: ["admin-growth-metrics", days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_growth_metrics" as never,
        { p_days: days } as never,
      );
      if (error) throw error;
      return parseAdminGrowthMetrics(data);
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Sums of a daily series for the selected window. */
export function sumDaily(daily: GrowthDay[]) {
  return daily.reduce(
    (acc, d) => ({
      new_customers: acc.new_customers + d.new_customers,
      new_providers: acc.new_providers + d.new_providers,
      bookings_created: acc.bookings_created + d.bookings_created,
      bookings_completed: acc.bookings_completed + d.bookings_completed,
      bookings_cancelled: acc.bookings_cancelled + d.bookings_cancelled,
      revenue: acc.revenue + d.revenue,
      platform_share: acc.platform_share + d.platform_share,
    }),
    {
      new_customers: 0,
      new_providers: 0,
      bookings_created: 0,
      bookings_completed: 0,
      bookings_cancelled: 0,
      revenue: 0,
      platform_share: 0,
    },
  );
}
