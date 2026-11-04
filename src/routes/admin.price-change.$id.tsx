import { QueryError } from "@/components/famio/QueryError";
import { useReviewProviderPriceChange } from "@/lib/db/admin-price-change-queries";
import { supabase } from "@/integrations/supabase/client";
import { currentLang } from "@/lib/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/price-change/$id")({
  component: AdminPriceChangeReview,
});

function AdminPriceChangeReview() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const lang = currentLang() === "ar" ? "ar" : "en";
  const review = useReviewProviderPriceChange(id);
  const [reason, setReason] = useState("");

  const q = useQuery({
    queryKey: ["admin", "price-change", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_services")
        .select(
          "id, price_override, pending_price_override, price_change_requested_at, provider:providers(profile:profiles(full_name, phone)), service:services(name_en, name_ar, minimum_price, maximum_price)",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (q.isLoading) return <p className="text-sm">{t("common.loading")}</p>;
  if (q.isError) return <QueryError onRetry={() => q.refetch()} />;
  if (!q.data?.pending_price_override) {
    return <p className="text-sm text-muted-foreground">{t("adminPriceChange.notPending")}</p>;
  }

  const service = q.data.service as { name_en?: string; name_ar?: string } | null;
  const profile = (q.data.provider as { profile?: { full_name?: string; phone?: string } } | null)
    ?.profile;
  const serviceName =
    lang === "ar" ? (service?.name_ar ?? service?.name_en) : (service?.name_en ?? service?.name_ar);

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-16">
      <div>
        <h1 className="text-xl font-extrabold">{t("adminPriceChange.reviewTitle")}</h1>
        <p className="text-sm text-muted-foreground">{serviceName}</p>
        <p className="text-sm">{profile?.full_name}</p>
      </div>

      <section className="rounded-2xl border border-border p-4 text-sm">
        <h2 className="mb-2 font-bold">{t("adminPriceChange.comparison")}</h2>
        <p>
          {t("adminPriceChange.current")}:{" "}
          <span className="font-bold tabular-nums">{q.data.price_override ?? "—"}</span> EGP
        </p>
        <p>
          {t("adminPriceChange.requested")}:{" "}
          <span className="font-bold tabular-nums text-brand">{q.data.pending_price_override}</span>{" "}
          EGP
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={review.isPending}
          className="min-h-11 rounded-xl bg-brand px-4 text-sm font-bold text-brand-foreground disabled:opacity-50"
          onClick={() =>
            review.mutate(
              { decision: "approved" },
              {
                onSuccess: () => toast.success(t("adminPriceChange.approved")),
                onError: () => toast.error(t("common.somethingWentWrong")),
              },
            )
          }
        >
          {t("adminReview.approve")}
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("adminPriceChange.rejectPlaceholder")}
            className="w-full rounded-xl border border-border p-3 text-sm"
          />
          <button
            type="button"
            disabled={!reason.trim() || review.isPending}
            className="min-h-11 rounded-xl border border-coral px-4 text-sm font-bold text-coral disabled:opacity-50"
            onClick={() =>
              review.mutate(
                { decision: "rejected", reason: reason.trim() },
                {
                  onSuccess: () => toast.success(t("adminPriceChange.rejected")),
                  onError: () => toast.error(t("common.somethingWentWrong")),
                },
              )
            }
          >
            {t("adminReview.reject")}
          </button>
        </div>
      </div>
    </div>
  );
}
