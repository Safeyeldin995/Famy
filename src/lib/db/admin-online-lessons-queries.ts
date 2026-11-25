import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OnlineKpiDelta = {
  current: number | null;
  previous: number | null;
  change: number | null;
  change_abs: number | null;
};

export type AdminOnlineLessonsReport = {
  period_from: string;
  period_to: string;
  previous_from: string;
  previous_to: string;
  timezone: string;
  filters: { subject_id: string | null; provider_id: string | null };
  kpis: {
    totals: Record<string, number | null>;
    period: Record<string, OnlineKpiDelta>;
  };
  funnel: {
    request: number;
    confirmed: number;
    paid: number;
    joined: number;
    completed: number;
    drop_off: Record<string, number>;
  };
  cancellations: Record<string, { count: number; amount: number }>;
  quality: {
    join_rate: number | null;
    avg_attended_minutes: number | null;
    no_show_reports: number;
    open_issue_reports: number;
  };
  top_teachers: Array<{
    provider_id: string;
    provider_name: string;
    lessons: number;
    completion_rate: number | null;
    earnings: number;
    rating_avg: number;
  }>;
  top_subjects: Array<{
    service_id: string;
    subject_name_en: string;
    subject_name_ar: string;
    lessons: number;
    revenue: number;
  }>;
  heatmap: Array<{ dow: number; hour: number; lessons: number }>;
  export_rows: Array<{
    booking_id: string;
    start_at: string;
    subject_en: string;
    subject_ar: string;
    teacher_name: string;
    student_phone_masked: string | null;
    status: string;
    price_total: number | null;
    price_commission_amount: number | null;
    price_provider_net: number | null;
    payment_method: string | null;
  }>;
};

export function useAdminOnlineLessonsReport(
  from: string | undefined,
  to: string | undefined,
  subjectId: string | null,
  providerId: string | null,
) {
  return useQuery({
    enabled: !!from && !!to,
    queryKey: ["admin", "online-lessons-report", from, to, subjectId, providerId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_online_lessons_report", {
        p_from: from!,
        p_to: to!,
        p_subject: subjectId,
        p_provider: providerId,
      });
      if (error) throw error;
      return data as AdminOnlineLessonsReport;
    },
  });
}

export function useAdminOnlineLessonFilterOptions() {
  return useQuery({
    queryKey: ["admin", "online-lessons-report", "filters"],
    queryFn: async () => {
      const [services, providers] = await Promise.all([
        supabase
          .from("services")
          .select("id, name_en, name_ar")
          .eq("is_active", true)
          .order("name_en"),
        supabase
          .from("providers")
          .select("id, profile:profiles(full_name)")
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (services.error) throw services.error;
      if (providers.error) throw providers.error;
      return {
        services: services.data ?? [],
        providers: (providers.data ?? []).map((row) => ({
          id: row.id as string,
          name: (row.profile as { full_name: string | null } | null)?.full_name ?? row.id,
        })),
      };
    },
  });
}
