import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type CustomerEducationProfileRow =
  Database["public"]["Tables"]["customer_education_profiles"]["Row"];

export type EducationProfileInput = {
  education_curriculum_id: string | null;
  education_level_id: string | null;
};

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
