import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  credentialFileError,
  credentialKeys,
  deleteCredential,
  fetchMyCredentials,
  fetchPublicCredentials,
  reviewCertificate,
  saveCertificate,
  saveEducation,
  saveExperience,
  uploadCredentialFile,
  type CertificateDraft,
  type CertificateStatus,
  type EducationDraft,
  type ExperienceDraft,
} from "@/lib/provider/credentials";

export function useMyCredentials(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: credentialKeys.mine(providerId),
    queryFn: () => fetchMyCredentials(supabase, providerId!),
  });
}

/** Admin reads through the admin RLS policy; same shape as the provider's own view. */
export function useAdminProviderCredentials(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: credentialKeys.admin(providerId),
    queryFn: () => fetchMyCredentials(supabase, providerId!),
  });
}

export function usePublicCredentials(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: credentialKeys.public(providerId),
    queryFn: () => fetchPublicCredentials(supabase, providerId!),
  });
}

export function useCredentialMutations(providerId: string | undefined) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: credentialKeys.mine(providerId) });
  return {
    education: useMutation({
      mutationFn: (v: { draft: EducationDraft; id?: string }) =>
        saveEducation(supabase, providerId!, v.draft, v.id),
      onSuccess: done,
    }),
    experience: useMutation({
      mutationFn: (v: { draft: ExperienceDraft; id?: string }) =>
        saveExperience(supabase, providerId!, v.draft, v.id),
      onSuccess: done,
    }),
    certificate: useMutation({
      mutationFn: async (v: { draft: CertificateDraft; id?: string; file?: File | null }) => {
        let filePath: string | null = null;
        if (v.file) {
          const fileError = credentialFileError(v.file.size, v.file.type);
          if (fileError)
            throw new Error(fileError === "size" ? "file_too_large" : "invalid_file_type");
          filePath = await uploadCredentialFile(
            supabase,
            providerId!,
            "certificate",
            { body: v.file, name: v.file.name, type: v.file.type, size: v.file.size },
            crypto.randomUUID(),
          );
        }
        await saveCertificate(supabase, providerId!, v.draft, { id: v.id, filePath });
      },
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (v: {
        table: "provider_education" | "provider_work_experience" | "provider_certificates";
        id: string;
        filePath?: string | null;
      }) => deleteCredential(supabase, v.table, v.id, v.filePath),
      onSuccess: done,
    }),
  };
}

export function useReviewCertificate(providerId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; status: CertificateStatus; note?: string | null }) =>
      reviewCertificate(supabase, v.id, v.status, v.note),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: credentialKeys.admin(providerId) });
      await qc.invalidateQueries({ queryKey: credentialKeys.public(providerId) });
      await qc.invalidateQueries({ queryKey: ["admin-pending-certificates"] });
    },
  });
}
