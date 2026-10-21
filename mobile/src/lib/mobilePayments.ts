import { Platform } from "react-native";
import { File } from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";
import { appConfig, supabase } from "./supabase";
import type { PendingPaymentSelection } from "./bookingPure";

async function selectionKey(bookingId: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("auth required");
  return `famy:pendingPayment:${session.user.id}:${bookingId}`;
}
export async function stashPayment(id: string, value: PendingPaymentSelection) {
  await AsyncStorage.setItem(await selectionKey(id), JSON.stringify(value));
}
export async function peekPayment(id: string): Promise<PendingPaymentSelection | null> {
  const raw = await AsyncStorage.getItem(await selectionKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
export async function clearPayment(id: string) {
  await AsyncStorage.removeItem(await selectionKey(id));
}

export async function startPaymob(bookingId: string, paymentId?: string) {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session) throw new Error("auth required");
  const response = await fetch(
    `${appConfig.webOrigin.replace(/\/$/, "")}/api/mobile/paymob-checkout`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bookingId, ...(paymentId ? { paymentId } : {}) }),
    },
  );
  const result = await response.json();
  if (
    !response.ok ||
    !result.ok ||
    typeof result.checkoutUrl !== "string" ||
    !result.checkoutUrl.startsWith("https://")
  )
    throw new Error("checkout failed");
  await WebBrowser.openBrowserAsync(result.checkoutUrl);
}

// Same bucket/path/mutation as src/lib/db/payment-queries.ts; ArrayBuffer works on native.
export async function uploadProof(
  bookingId: string,
  paymentId: string,
  asset: { uri: string; fileName?: string | null; mimeType?: string | null; fileSize?: number },
) {
  if (asset.fileSize != null && asset.fileSize > 10 * 1024 * 1024) throw new Error("fileTooLarge");
  const nativeFile = Platform.OS !== "web" ? new File(asset.uri) : null;
  if (nativeFile && nativeFile.size > 10 * 1024 * 1024) throw new Error("fileTooLarge");
  const bytes = nativeFile
    ? await nativeFile.arrayBuffer()
    : await (await fetch(asset.uri)).arrayBuffer();
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("fileTooLarge");
  const ext = (
    asset.fileName?.split(".").pop() ||
    asset.mimeType?.split("/").pop() ||
    "jpg"
  ).replace(/[^a-z0-9]/gi, "");
  const path = `${bookingId}/proof-${Date.now()}.${ext}`;
  const { error: upError } = await supabase.storage
    .from("payment-proofs")
    .upload(path, bytes, { contentType: asset.mimeType || "image/jpeg", upsert: false });
  if (upError) throw upError;
  const { error } = await supabase
    .from("payments")
    .update({ proof_path: path, proof_uploaded_at: new Date().toISOString() })
    .eq("id", paymentId);
  if (error) throw error;
}

// Same ten-minute signed receipt URL as src/lib/db/payment-queries.ts.
export async function openProof(path: string) {
  const { data, error } = await supabase.storage
    .from("payment-proofs")
    .createSignedUrl(path, 60 * 10);
  if (error) throw error;
  await WebBrowser.openBrowserAsync(data.signedUrl);
}
