// Student learning profile, booking flow (issue 536 PR 2): app data hooks.
// Mirrors src/lib/db/student-match-queries.ts. The RPCs come from migration 20261126160000.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { isTutoringCategorySlug } from "@shared/tutoring/teachingCapabilities";
import { tutorMissingTeachingData } from "@shared/tutoring/studentLearnerFlow";

export type CurriculumWithStyle = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  sort_order: number;
  level_label_style: string | null;
};

// The generated Database types don't include the PR 1 RPCs yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (name: string, args?: Record<string, unknown>) => (supabase.rpc as any)(name, args);

export function useCurriculaWithStyle() {
  return useQuery({
    queryKey: ["teaching-curricula-style"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teaching_curricula")
        .select("id, code, name_ar, name_en, sort_order, level_label_style" as "id")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CurriculumWithStyle[];
    },
  });
}

export function useRequestTutorAvailability() {
  return useMutation({
    mutationFn: async (input: {
      serviceId: string;
      subjectId: string | null;
      curriculumId: string | null;
      levelId: string | null;
      serviceMode: "online" | "in_person";
      familyMemberId: string | null;
    }) => {
      const { data, error } = await rpc("request_tutor_availability", {
        p_service_id: input.serviceId,
        p_subject_id: input.subjectId,
        p_curriculum_id: input.curriculumId,
        p_level_id: input.levelId,
        p_service_mode: input.serviceMode,
        p_family_member_id: input.familyMemberId,
      });
      if (error) throw error;
      return data as { status?: string } | null;
    },
  });
}

export function useConfirmStudentGrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (familyMemberId: string | null) => {
      const { error } = await rpc("confirm_student_grade", { p_family_member_id: familyMemberId });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["family-members"] });
      void qc.invalidateQueries({ queryKey: ["customer-education-profile"] });
    },
  });
}

const LEARNER_KEY = "famy.match.learner";

/** The last «الحجز لمين؟» choice, remembered on the device. */
export function useRememberedLearner(): [string | null, (id: string) => void] {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(LEARNER_KEY)
      .then((v) => {
        if (live) setValue(v);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const remember = useCallback((id: string) => {
    setValue(id);
    void AsyncStorage.setItem(LEARNER_KEY, id).catch(() => undefined);
  }, []);
  return [value, remember];
}

/** Tutor banner: an approved tutoring service with no approved subject / system / grade. */
export function useTutorMissingTeachingData(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["tutor-missing-teaching-data", providerId],
    queryFn: async () => {
      const [servicesRes, capsRes] = await Promise.all([
        supabase
          .from("provider_services")
          .select("service_id, status, service:services(category:categories(slug))")
          .eq("provider_id", providerId!),
        supabase
          .from("provider_teaching_capabilities")
          .select("service_id, status")
          .eq("provider_id", providerId!)
          .eq("status", "approved"),
      ]);
      if (servicesRes.error) throw servicesRes.error;
      if (capsRes.error) throw capsRes.error;
      type ServiceRow = {
        service_id: string;
        status: string | null;
        service: { category: { slug: string | null } | null } | null;
      };
      const approvedTutoringServiceIds = ((servicesRes.data ?? []) as unknown as ServiceRow[])
        .filter((r) => r.status === "approved" && isTutoringCategorySlug(r.service?.category?.slug))
        .map((r) => r.service_id);
      const approvedCapabilityServiceIds = ((capsRes.data ?? []) as { service_id: string }[]).map(
        (r) => r.service_id,
      );
      return tutorMissingTeachingData({ approvedTutoringServiceIds, approvedCapabilityServiceIds });
    },
  });
}
