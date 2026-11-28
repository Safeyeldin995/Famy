import { Platform } from "react-native";
import { File } from "expo-file-system";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  credentialFileError,
  credentialKeys,
  deleteCredential,
  fetchMyCredentials,
  fetchPublicCredentials,
  saveCertificate,
  saveEducation,
  saveExperience,
  uploadCredentialFile,
  type CertificateDraft,
  type EducationDraft,
  type ExperienceDraft,
} from "@shared/provider/credentials";
import type { PickedFile } from "./documentUpload";

export function useMyCredentials(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: credentialKeys.mine(providerId),
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

function newId() {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readPicked(file: PickedFile) {
  const type = (file.mimeType || "image/jpeg").toLowerCase();
  const early = credentialFileError(file.fileSize ?? null, type);
  if (early === "type") throw new Error("invalid_file_type");
  if (early === "size") throw new Error("file_too_large");
  const nativeFile = Platform.OS !== "web" ? new File(file.uri) : null;
  const body = nativeFile
    ? await nativeFile.arrayBuffer()
    : await (await fetch(file.uri)).arrayBuffer();
  if (credentialFileError(body.byteLength, type) === "size") throw new Error("file_too_large");
  return {
    body,
    type,
    name: file.fileName || `file.${type === "application/pdf" ? "pdf" : "jpg"}`,
  };
}

export function useCredentialMutations(providerId: string | undefined) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: credentialKeys.mine(providerId) });
  return {
    education: useMutation({
      mutationFn: async (v: { draft: EducationDraft; id?: string }) => {
        await saveEducation(supabase, providerId!, v.draft, v.id);
      },
      onSuccess: done,
    }),
    experience: useMutation({
      mutationFn: async (v: { draft: ExperienceDraft; id?: string }) => {
        await saveExperience(supabase, providerId!, v.draft, v.id);
      },
      onSuccess: done,
    }),
    certificate: useMutation({
      mutationFn: async (v: { draft: CertificateDraft; id?: string; file?: PickedFile | null }) => {
        let filePath: string | null = null;
        if (v.file) {
          const read = await readPicked(v.file);
          filePath = await uploadCredentialFile(
            supabase,
            providerId!,
            "certificate",
            read,
            newId(),
          );
        }
        await saveCertificate(supabase, providerId!, v.draft, { id: v.id, filePath });
      },
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: async (v: {
        table: "provider_education" | "provider_work_experience" | "provider_certificates";
        id: string;
        filePath?: string | null;
      }) => {
        await deleteCredential(supabase, v.table, v.id, v.filePath);
      },
      onSuccess: done,
    }),
  };
}
