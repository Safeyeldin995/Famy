import { Platform } from "react-native";
import { File } from "expo-file-system";
import { supabase } from "@/lib/supabase";
import type { DocumentUploadType } from "./onboardingQueries";

export type PickedFile = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
};

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/jpg", "application/pdf"];

async function fileBytes(asset: PickedFile) {
  if (asset.fileSize != null && asset.fileSize > MAX_BYTES) throw new Error("file_too_large");
  const nativeFile = Platform.OS !== "web" ? new File(asset.uri) : null;
  if (nativeFile && nativeFile.size > MAX_BYTES) throw new Error("file_too_large");
  const bytes = nativeFile
    ? await nativeFile.arrayBuffer()
    : await (await fetch(asset.uri)).arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) throw new Error("file_too_large");
  return bytes;
}

function contentType(asset: PickedFile) {
  const mime = asset.mimeType || "image/jpeg";
  if (!ALLOWED.includes(mime)) throw new Error("invalid_file_type");
  return mime;
}

export async function uploadProviderDocument(type: DocumentUploadType, asset: PickedFile) {
  const mime = contentType(asset);
  const bytes = await fileBytes(asset);
  const { data: prep, error: prepErr } = await supabase.rpc("provider_prepare_document_upload", {
    p_type: type,
    p_content_type: mime,
    p_size_bytes: bytes.byteLength,
  });
  if (prepErr) throw prepErr;
  const path = (prep as { path: string }).path;
  const { error: upErr } = await supabase.storage
    .from("provider-documents")
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (upErr) throw upErr;
  const { data: docId, error: finErr } = await supabase.rpc("provider_finalize_document_upload", {
    p_path: path,
    p_type: type,
  });
  if (finErr) throw finErr;
  return { docId, path };
}

export async function uploadAvatar(profileId: string, asset: PickedFile) {
  const mime = contentType(asset);
  const bytes = await fileBytes(asset);
  const ext = (asset.fileName?.split(".").pop() || mime.split("/").pop() || "jpg")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
  const path = `${profileId}/avatar-${Date.now()}.${ext === "jpeg" ? "jpg" : ext}`;
  const { error: upErr } = await supabase.storage
    .from("avatars")
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (upErr) throw upErr;
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: path })
    .eq("id", profileId);
  if (error) throw error;
  return path;
}
