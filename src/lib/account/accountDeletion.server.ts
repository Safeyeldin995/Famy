import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AccountDeletionCheck, StoragePathRef } from "@/lib/account/accountDeletion.types";

export type { AccountDeletionCheck, StoragePathRef } from "@/lib/account/accountDeletion.types";

type AdminAuthClient = {
  auth: {
    admin: {
      updateUserById: (
        id: string,
        attrs: Record<string, unknown>,
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
};

type ServiceSupabase = SupabaseClient<Database> & {
  storage: {
    from: (bucket: string) => {
      remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
    };
  };
};

export function parseAnonymizeStoragePaths(payload: unknown): StoragePathRef[] {
  if (!payload || typeof payload !== "object") return [];
  const raw = (payload as { storage_paths?: unknown }).storage_paths;
  if (!Array.isArray(raw)) return [];
  const out: StoragePathRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const bucket = (item as { bucket?: unknown }).bucket;
    const path = (item as { path?: unknown }).path;
    if (typeof bucket === "string" && typeof path === "string" && bucket && path) {
      out.push({ bucket, path });
    }
  }
  return out;
}

export async function removeAnonymizedStorageObjects(
  supabaseAdmin: ServiceSupabase,
  paths: StoragePathRef[],
): Promise<void> {
  const byBucket = new Map<string, string[]>();
  for (const { bucket, path } of paths) {
    const list = byBucket.get(bucket) ?? [];
    list.push(path);
    byBucket.set(bucket, list);
  }
  for (const [bucket, bucketPaths] of byBucket) {
    const { error } = await supabaseAdmin.storage.from(bucket).remove(bucketPaths);
    if (error) throw error;
  }
}

export async function userHasAdminRole(
  supabaseAdmin: SupabaseClient<Database>,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function finalizeDeletedAuthUser(
  supabaseAdmin: AdminAuthClient,
  userId: string,
): Promise<void> {
  const password = randomBytes(32).toString("base64url");
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    email: `deleted-${userId}@famio.local`,
    phone: "",
    password,
    ban_duration: "876000h",
    email_confirm: true,
  });
  if (error) throw error;
}

export async function runAccountDeletion(params: {
  supabaseUser: SupabaseClient<Database>;
  supabaseAdmin: ServiceSupabase & AdminAuthClient;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (await userHasAdminRole(params.supabaseAdmin, params.userId)) {
    return { ok: false, error: "admin_not_allowed", status: 403 };
  }

  const { data: checkRaw, error: checkError } = await params.supabaseUser.rpc(
    "account_deletion_check",
  );
  if (checkError) {
    console.error("[account.delete] eligibility check failed");
    return { ok: false, error: "deletion_failed", status: 500 };
  }

  const check = checkRaw as AccountDeletionCheck | null;
  if (!check?.ok) {
    const reason = check?.reason ?? "not_authenticated";
    if (reason === "not_authenticated") {
      return { ok: false, error: "unauthorized", status: 401 };
    }
    if (reason === "admin") {
      return { ok: false, error: "admin_not_allowed", status: 403 };
    }
    return { ok: false, error: "active_bookings", status: 409 };
  }

  const { data: anonymized, error: anonymizeError } = await params.supabaseAdmin.rpc(
    "anonymize_account",
    { p_user_id: params.userId },
  );
  if (anonymizeError) {
    console.error("[account.delete] anonymize failed");
    return { ok: false, error: "deletion_failed", status: 500 };
  }

  try {
    await removeAnonymizedStorageObjects(
      params.supabaseAdmin,
      parseAnonymizeStoragePaths(anonymized),
    );
    await finalizeDeletedAuthUser(params.supabaseAdmin, params.userId);
  } catch {
    console.error("[account.delete] post-anonymize failed");
    return { ok: false, error: "deletion_failed", status: 500 };
  }

  return { ok: true };
}
