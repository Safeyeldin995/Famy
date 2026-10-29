import { QueryError } from "@/components/famio/QueryError";
import {
  useAdminProviderServiceRequest,
  useReviewProviderServiceRequest,
} from "@/lib/db/admin-service-request-queries";
import { useAdminEvidenceSignedUrl } from "@/lib/db/admin-queries";
import { isTutoringCategorySlug } from "@/lib/tutoring/teachingCapabilities";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { currentLang } from "@/lib/i18n";

export const Route = createFileRoute("/admin/service-request/$id")({
  component: AdminServiceRequestReview,
});

function AdminServiceRequestReview() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const lang = currentLang() === "ar" ? "ar" : "en";
  const q = useAdminProviderServiceRequest(id);
  const review = useReviewProviderServiceRequest(id);
  const signUrl = useAdminEvidenceSignedUrl();
  const [reason, setReason] = useState("");

  if (q.isLoading) return <p className="text-sm">{t("common.loading")}</p>;
  if (q.isError) return <QueryError onRetry={() => q.refetch()} />;

  const payload = q.data ?? {};
  const ps = payload.provider_service as { id: string; status: string; price_override?: number | null };
  const provider = payload.provider as {
    profile?: { full_name?: string; phone?: string };
    max_children_per_booking?: number | null;
  };
  const service = payload.service as {
    name_en?: string;
    name_ar?: string;
    category_slug?: string;
    minimum_price?: number | null;
    maximum_price?: number | null;
  };
  const caps = (payload.teaching_capabilities as Array<Record<string, unknown>>) ?? [];
  const reqs = (payload.requirement_fulfillments as Array<Record<string, unknown>>) ?? [];
  const ageGroups = (payload.age_group_capabilities as Array<Record<string, unknown>>) ?? [];

  const serviceName =
    lang === "ar" ? service.name_ar ?? service.name_en : service.name_en ?? service.name_ar;

  const openEvidence = async (path: string) => {
    try {
      const url = await signUrl.mutateAsync(path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error(t("common.somethingWentWrong"));
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-16">
      <div>
        <h1 className="text-xl font-extrabold">{t("adminServiceRequest.reviewTitle")}</h1>
        <p className="text-sm text-muted-foreground">{serviceName}</p>
        <p className="text-sm">{provider.profile?.full_name}</p>
      </div>

      {!isTutoringCategorySlug(service.category_slug) && ps.price_override != null && (
        <section className="rounded-2xl border border-border p-4">
          <h2 className="text-sm font-bold">{t("adminServiceRequest.price")}</h2>
          <p className="text-sm">{ps.price_override}</p>
        </section>
      )}

      {service.category_slug === "babysitting" && (
        <section className="rounded-2xl border border-border p-4 text-sm">
          <h2 className="font-bold">{t("adminServiceRequest.babysitting")}</h2>
          <p>
            {t("adminServiceRequest.maxChildren")}: {provider.max_children_per_booking ?? "—"}
          </p>
          <ul className="mt-2 list-disc ps-5">
            {ageGroups.map((row) => (
              <li key={String(row.id ?? row.age_group_code)}>
                {String(row.age_group_code)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {caps.length > 0 && (
        <section className="rounded-2xl border border-border p-4">
          <h2 className="mb-2 text-sm font-bold">{t("adminServiceRequest.teaching")}</h2>
          <ul className="space-y-2 text-sm">
            {caps.map((cap) => (
              <li key={String(cap.id)} className="rounded-xl border border-border/60 p-2">
                <p>
                  {t("adminServiceRequest.capabilityLine", {
                    duration: cap.session_duration_min,
                    price: cap.session_price,
                    status: cap.status,
                  })}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {reqs.length > 0 && (
        <section className="rounded-2xl border border-border p-4">
          <h2 className="mb-2 text-sm font-bold">{t("adminServiceRequest.requirements")}</h2>
          <ul className="space-y-2 text-sm">
            {reqs.map((row, idx) => {
              const requirement = row.requirement as { name_en?: string; name_ar?: string };
              const fulfillment = row.fulfillment as { evidence_storage_path?: string | null } | null;
              const label =
                lang === "ar"
                  ? requirement?.name_ar ?? requirement?.name_en
                  : requirement?.name_en ?? requirement?.name_ar;
              return (
                <li key={idx} className="rounded-xl border border-border/60 p-2">
                  <p className="font-semibold">{label}</p>
                  {fulfillment?.evidence_storage_path && (
                    <button
                      type="button"
                      className="mt-1 text-xs font-bold text-brand"
                      onClick={() => openEvidence(fulfillment.evidence_storage_path!)}
                    >
                      {t("adminServiceRequest.viewEvidence")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {ps.status === "pending" && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={review.isPending}
            className="min-h-11 rounded-xl bg-brand px-4 text-sm font-bold text-brand-foreground disabled:opacity-50"
            onClick={() =>
              review.mutate(
                { status: "approved" },
                {
                  onSuccess: () => toast.success(t("adminServiceRequest.approved")),
                  onError: () => toast.error(t("admin.provider.approveServiceError")),
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
              placeholder={t("adminReview.rejectServicePlaceholder")}
              className="w-full rounded-xl border border-border p-3 text-sm"
            />
            <button
              type="button"
              disabled={!reason.trim() || review.isPending}
              className="min-h-11 rounded-xl border border-coral px-4 text-sm font-bold text-coral disabled:opacity-50"
              onClick={() =>
                review.mutate(
                  { status: "rejected", reason: reason.trim() },
                  {
                    onSuccess: () => toast.success(t("adminServiceRequest.rejected")),
                    onError: () => toast.error(t("admin.provider.rejectServiceError")),
                  },
                )
              }
            >
              {t("adminReview.reject")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
