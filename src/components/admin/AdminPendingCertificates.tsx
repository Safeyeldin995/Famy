import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Award } from "lucide-react";
import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { supabase } from "@/integrations/supabase/client";

type PendingCertificate = {
  id: string;
  provider_id: string;
  title: string;
  provider: { profile: { full_name: string | null } | null } | null;
};

/** Certificates waiting for «اتأكدنا منها», each linking to the provider page. Hidden when none. */
export function AdminPendingCertificates() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["admin-pending-certificates"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("provider_certificates")
        .select("id, provider_id, title, provider:providers(profile:profiles(full_name))")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as PendingCertificate[];
    },
  });
  if (!q.data?.length) return null;
  return (
    <section
      className="grid gap-2 rounded-2xl border border-border bg-surface p-4"
      aria-labelledby="pending-certs-title"
    >
      <h2 id="pending-certs-title" className="flex items-center gap-2 text-sm font-bold">
        <Award size={16} aria-hidden />
        {t("providerCredentials.admin.pendingCount", { count: q.data.length })}
      </h2>
      <ul className="grid gap-1">
        {q.data.map((c) => (
          <li key={c.id}>
            <Link
              to={"/admin/provider/$id" as const}
              params={{ id: c.provider_id }}
              hash="admin-provider-credentials"
              className="focus-ring flex min-h-11 items-center justify-between gap-2 rounded-xl px-2 text-sm hover:bg-surface-2"
            >
              <span className="min-w-0 truncate font-semibold">
                {c.provider?.profile?.full_name || t("admin.provider.unnamed")}
              </span>
              <span className="min-w-0 truncate text-muted-foreground">{c.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
