import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronLeft, FileText, ShieldCheck, Trash2 } from "lucide-react";
import {
  useAdminBabysittingAgeGroups,
  useAdminProvider,
  useApproveProviderApplicationAll,
  useDocumentSignedUrl,
  useProviderEligibility,
  useSetProviderActive,
  useSetProviderServiceStatus,
} from "@/lib/db/admin-queries";
import {
  useAdminOnboardingAction,
  useAdminOnboardingReview,
  useReviewProviderDocument,
} from "@/lib/provider/onboarding-queries";
import {
  useAddVacation,
  useDeleteVacation,
  useProviderAvailability,
  useProviderVacations,
} from "@/lib/db/provider-queries";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { AdminReviewSection } from "@/components/admin/AdminReviewSection";
import { AdminReasonSheet } from "@/components/admin/AdminReasonSheet";
import { workingHoursSummary } from "@/lib/provider/workingHoursSummary";
import { adminLocationLabel } from "@/components/admin/adminLocationLabel";
import { ScheduleDateSheet } from "@/components/provider/ScheduleDateSheet";
import { ProviderApprovalDecisionSummary } from "@/components/admin/ProviderApprovalDecisionSummary";
import { TeachingCapabilityReviewQueue } from "@/components/admin/TeachingCapabilityReviewQueue";
import { RequestUpdatedDetailsAction } from "@/components/admin/RequestUpdatedDetailsAction";
import {
  deriveAdminApprovalDecision,
  formatAdminActionErrorMessage,
  type OnboardingCompletionPayload,
} from "@/lib/admin/providerApprovalReview";
import { adminPath } from "@/lib/preview/previewPath";
import { currentLang } from "@/lib/i18n";

export const Route = createFileRoute("/admin/provider/$id")({ component: AdminProviderRoute });

type ReviewPayload = {
  completion?: OnboardingCompletionPayload;
  details?: {
    date_of_birth?: string | null;
    governorate?: string | null;
    area?: string | null;
    full_address?: string | null;
    previous_work?: string | null;
  } | null;
  documents?: Array<{ id?: string; type?: string; status?: string }>;
  references?: Array<{ id: string; full_name?: string; relationship?: string; phone?: string }>;
  zones?: Array<{ id: string; name_en?: string; name_ar?: string }>;
  events?: Array<{ action?: string; new_status?: string }>;
};

function latin(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-US") : "—";
}

function IdentityDocuments({
  provider,
  openDocument,
}: {
  provider: any;
  openDocument: (path: string) => void;
}) {
  const { t } = useTranslation();
  const review = useReviewProviderDocument();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const documents = provider.documents ?? [];
  return (
    <div className="space-y-3">
      <p className="break-words font-semibold">
        {provider.profile?.full_name || t("admin.provider.unnamed")}
      </p>
      <p dir="ltr" className="break-all text-start text-xs text-muted-foreground">
        {provider.profile?.phone} · {provider.profile?.email}
      </p>
      {documents.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("admin.provider.noDocuments")}</p>
      )}
      <ul className="space-y-2">
        {documents.map((document: any) => (
          <li key={document.id} className="rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {(document.type ?? document.document_type) === "national_id"
                    ? t("adminReview.nationalId")
                    : String(
                        t(
                          "admin.provider.approvalReview.documentTypes." +
                            (document.type ?? document.document_type),
                          document.type ?? document.document_type ?? t("adminReview.unavailable"),
                        ),
                      )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {String(t("admin.provider.documentStatus." + document.status, document.status))}
                </p>
              </div>
              <button
                type="button"
                disabled={!document.storage_path}
                onClick={() => openDocument(document.storage_path)}
                className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm font-bold disabled:opacity-50"
              >
                <FileText className="h-4 w-4" />
                {t("adminReview.openDocument")}
              </button>
            </div>
            {document.status === "pending" && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={review.isPending}
                  onClick={() =>
                    review.mutate(
                      { documentId: document.id, status: "approved" },
                      { onError: (error) => toast.error(formatAdminActionErrorMessage(t, error)) },
                    )
                  }
                  className="focus-ring min-h-11 rounded-xl bg-brand px-4 text-sm font-bold text-brand-foreground disabled:opacity-50"
                >
                  {t("adminReview.approve")}
                </button>
                <button
                  type="button"
                  disabled={review.isPending}
                  onClick={() => {
                    setRejecting(document.id);
                    setReason("");
                  }}
                  className="focus-ring min-h-11 rounded-xl border border-coral px-4 text-sm font-bold text-coral"
                >
                  {t("adminReview.reject")}
                </button>
              </div>
            )}
            {rejecting === document.id && (
              <div className="mt-3 space-y-2">
                <label
                  className="block text-sm font-semibold"
                  htmlFor={"document-reason-" + document.id}
                >
                  {t("adminReview.reason")}
                </label>
                <textarea
                  id={"document-reason-" + document.id}
                  rows={2}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="w-full rounded-xl border border-border bg-surface p-3 text-sm"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!reason.trim() || review.isPending}
                    onClick={() =>
                      review.mutate(
                        { documentId: document.id, status: "rejected", reason: reason.trim() },
                        {
                          onSuccess: () => setRejecting(null),
                          onError: (error) => toast.error(formatAdminActionErrorMessage(t, error)),
                        },
                      )
                    }
                    className="focus-ring min-h-11 flex-1 rounded-xl bg-coral px-3 text-sm font-bold text-coral-foreground disabled:opacity-50"
                  >
                    {t("common.confirm")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejecting(null)}
                    className="focus-ring min-h-11 flex-1 rounded-xl border border-border px-3 text-sm font-bold"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProviderServices({ provider }: { provider: any }) {
  const { t } = useTranslation();
  const lang = currentLang() === "ar" ? "ar" : "en";
  const review = useSetProviderServiceStatus();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const services = provider.services ?? [];
  if (services.length === 0)
    return <p className="text-sm text-muted-foreground">{t("adminReview.noServices")}</p>;
  return (
    <ul className="space-y-2">
      {services.map((row: any) => {
        const service = row.service;
        const name =
          lang === "ar"
            ? service?.name_ar || service?.name_en
            : service?.name_en || service?.name_ar;
        const amount = row.price_override ?? service?.base_price ?? provider.hourly_rate;
        return (
          <li key={row.id} className="rounded-xl border border-border p-3">
            <div className="flex flex-wrap justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold">{name}</p>
                <p className="text-xs text-muted-foreground">
                  {t(
                    service?.pricing_model === "hourly"
                      ? "adminReview.price"
                      : "adminReview.sessionPrice",
                    { amount: latin(amount) },
                  )}{" "}
                  · {String(t("admin.provider.serviceStatus." + row.status, row.status))}
                </p>
              </div>
              {row.status === "pending" && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() =>
                      review.mutate(
                        { providerServiceId: row.id, status: "approved" },
                        { onError: () => toast.error(t("admin.provider.approveServiceError")) },
                      )
                    }
                    className="focus-ring min-h-11 rounded-xl bg-brand px-3 text-sm font-bold text-brand-foreground disabled:opacity-50"
                  >
                    {t("adminReview.approve")}
                  </button>
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => {
                      setRejecting(row.id);
                      setReason("");
                    }}
                    className="focus-ring min-h-11 rounded-xl border border-coral px-3 text-sm font-bold text-coral"
                  >
                    {t("adminReview.reject")}
                  </button>
                </div>
              )}
            </div>
            {rejecting === row.id && (
              <div className="mt-3 space-y-2">
                <label className="block text-sm font-semibold" htmlFor={"service-reason-" + row.id}>
                  {t("adminReview.reason")}
                </label>
                <textarea
                  id={"service-reason-" + row.id}
                  rows={2}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="w-full rounded-xl border border-border bg-surface p-3 text-sm"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!reason.trim() || review.isPending}
                    onClick={() =>
                      review.mutate(
                        { providerServiceId: row.id, status: "rejected", reason: reason.trim() },
                        {
                          onSuccess: () => setRejecting(null),
                          onError: () => toast.error(t("admin.provider.rejectServiceError")),
                        },
                      )
                    }
                    className="focus-ring min-h-11 flex-1 rounded-xl bg-coral px-3 text-sm font-bold text-coral-foreground disabled:opacity-50"
                  >
                    {t("common.confirm")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejecting(null)}
                    className="focus-ring min-h-11 flex-1 rounded-xl border border-border px-3 text-sm font-bold"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function HoursAndZones({
  providerId,
  zones,
}: {
  providerId: string;
  zones: ReviewPayload["zones"];
}) {
  const { t } = useTranslation();
  const hours = useProviderAvailability(providerId);
  const vacations = useProviderVacations(providerId);
  const addVacation = useAddVacation();
  const deleteVacation = useDeleteVacation();
  const [showDateSheet, setShowDateSheet] = useState(false);
  const lang = currentLang() === "ar" ? "ar" : "en";
  const displayDate = (value: string) => {
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }).format(date);
  };
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-bold">{t("admin.provider.weeklyHours")}</h3>
        {hours.isError && (
          <AdminQueryError
            compact
            message={t("admin.providers.loadError")}
            error={hours.error}
            onRetry={() => hours.refetch()}
          />
        )}
        <ul className="mt-1 space-y-1">
          {workingHoursSummary(hours.data ?? [], t).map((summary) => (
            <li key={summary} className="text-sm">
              {summary}
            </li>
          ))}
        </ul>
        {!hours.isLoading && !hours.isError && !hours.data?.length && (
          <p className="text-sm text-muted-foreground">{t("admin.provider.noWeeklyHours")}</p>
        )}
      </div>
      <div>
        <h3 className="text-sm font-bold">{t("adminReview.workZones")}</h3>
        {zones?.length ? (
          <ul className="mt-1 space-y-1">
            {zones.map((zone) => (
              <li key={zone.id} className="text-sm">
                {lang === "ar" ? zone.name_ar || zone.name_en : zone.name_en || zone.name_ar}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("adminReview.noZones")}</p>
        )}
      </div>
      <div className="border-t border-border pt-3">
        <h3 className="text-sm font-bold">{t("admin.provider.blockedPeriods")}</h3>
        {vacations.isError && (
          <AdminQueryError
            compact
            message={t("admin.providers.loadError")}
            error={vacations.error}
            onRetry={() => vacations.refetch()}
          />
        )}
        <ul className="mt-1 space-y-1">
          {(vacations.data ?? []).map((row: any) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-2 text-sm"
            >
              <span>
                {displayDate(row.start_date)} – {displayDate(row.end_date)} · {row.reason}
              </span>
              <button
                type="button"
                disabled={deleteVacation.isPending}
                onClick={() => deleteVacation.mutate({ id: row.id, providerId })}
                aria-label={t("common.delete")}
                className="focus-ring grid min-h-11 min-w-11 place-items-center rounded-xl border border-border"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={addVacation.isPending}
          onClick={() => {
            addVacation.reset();
            setShowDateSheet(true);
          }}
          className="focus-ring mt-2 min-h-11 rounded-xl bg-coral px-4 text-sm font-bold text-coral-foreground disabled:opacity-50"
        >
          {t("admin.provider.blockPeriod")}
        </button>
        {showDateSheet && (
          <ScheduleDateSheet
            range
            busy={addVacation.isPending}
            error={addVacation.isError}
            onClose={() => {
              setShowDateSheet(false);
              addVacation.reset();
            }}
            onSave={(start, end, reason) => {
              if (!reason.trim()) {
                toast.error(t("adminReview.reasonRequired"));
                return;
              }
              addVacation.mutate(
                { providerId, start_date: start, end_date: end, reason: reason.trim() },
                {
                  onSuccess: () => setShowDateSheet(false),
                  onError: () => toast.error(t("common.somethingWentWrong")),
                },
              );
            }}
          />
        )}
      </div>
    </div>
  );
}

function EligibilityDetails({ providerId }: { providerId: string }) {
  const { t } = useTranslation();
  const q = useProviderEligibility(providerId);
  const lang = currentLang() === "ar" ? "ar" : "en";
  if (q.isError)
    return (
      <AdminQueryError
        compact
        message={t("admin.providers.loadError")}
        error={q.error}
        onRetry={() => q.refetch()}
      />
    );
  return (
    <ul className="space-y-2">
      {(q.data ?? []).map((service: any) => (
        <li key={service.service_id} className="rounded-xl border border-border p-3 text-sm">
          <span className="font-semibold">
            {lang === "ar"
              ? service.service_name_ar || service.service_name_en
              : service.service_name_en}
          </span>
          <span className="ms-2 text-xs">
            {service.is_eligible ? t("adminReview.approved") : t("adminReview.blocked")}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AdminProvider({ id }: { id: string }) {
  const { t } = useTranslation();
  const provider = useAdminProvider(id);
  const onboarding = useAdminOnboardingReview(id);
  const action = useAdminOnboardingAction();
  const approveAll = useApproveProviderApplicationAll();
  const ages = useAdminBabysittingAgeGroups(id);
  const signing = useDocumentSignedUrl();
  const setActive = useSetProviderActive();
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const p: any = provider.data;
  const payload = onboarding.data as ReviewPayload | undefined;
  const decision = useMemo(
    () =>
      deriveAdminApprovalDecision({
        onboardingStatus: p?.onboarding_status,
        completion: payload?.completion,
        reviewDocuments: payload?.documents ?? p?.documents,
        isLoading: onboarding.isLoading,
        isError: onboarding.isError,
      }),
    [p?.onboarding_status, p?.documents, payload, onboarding.isLoading, onboarding.isError],
  );

  if (provider.isLoading) return <div className="p-5 text-sm">{t("common.loading")}</div>;
  if (provider.isError)
    return (
      <div className="p-5">
        <AdminQueryError
          message={t("admin.providers.loadError")}
          error={provider.error}
          onRetry={() => provider.refetch()}
        />
      </div>
    );
  if (!p) return <div className="p-5 text-sm">{t("admin.provider.notFound")}</div>;
  if (onboarding.isLoading) return <div className="p-5 text-sm">{t("common.loading")}</div>;
  if (onboarding.isError || !payload)
    return (
      <div className="p-5">
        <AdminQueryError
          message={t("admin.provider.approvalReview.loadError")}
          error={onboarding.error}
          onRetry={() => onboarding.refetch()}
        />
      </div>
    );

  const canReview = ["SUBMITTED", "UNDER_REVIEW"].includes(p.onboarding_status);
  const submittedAt = p.resubmitted_at ?? p.submitted_at;
  const details = payload?.details;
  const openDocument = async (path: string) => {
    try {
      const url = await signing.mutateAsync(path);
      window.open(url, "_blank", "noopener");
    } catch {
      toast.error(t("common.somethingWentWrong"));
    }
  };

  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-5 sm:px-6">
      <Link
        to={adminPath("/admin/providers") as "/admin/providers"}
        className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-bold"
      >
        <ChevronLeft className="h-4 w-4" />
        {t("common.back")}
      </Link>
      <header className="rounded-2xl border border-border bg-surface p-4">
        <h1 className="text-xl font-extrabold">
          {p.profile?.full_name || t("admin.provider.unnamed")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {p.onboarding_status
            ? String(t("pro.onboardingWizard.status." + p.onboarding_status, p.onboarding_status))
            : t("admin.provider.approvalReview.statusUnknown")}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">{t("adminReview.sectionApproveHint")}</p>
      </header>
      <ProviderApprovalDecisionSummary decision={decision} compact />
      {decision.canStartReview && (
        <button
          type="button"
          disabled={action.isPending}
          onClick={() =>
            action.mutate(
              { providerId: id, action: "start_review" },
              { onError: (error) => toast.error(formatAdminActionErrorMessage(t, error)) },
            )
          }
          className="focus-ring min-h-11 rounded-xl px-2 text-sm font-bold text-muted-foreground disabled:opacity-50"
        >
          {t("admin.provider.startReview")}
        </button>
      )}
      {decision.showApproveAction && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!decision.canApprove || approveAll.isPending || onboarding.isLoading}
            onClick={() => setConfirmAll(true)}
            className="focus-ring min-h-12 flex-1 rounded-xl bg-brand px-3 py-3 text-sm font-extrabold text-brand-foreground disabled:opacity-50"
          >
            {t("adminReview.approveAll")}
          </button>
          <button
            type="button"
            disabled={action.isPending || approveAll.isPending}
            onClick={() => setConfirmReject(true)}
            className="focus-ring min-h-11 rounded-xl px-3 text-sm font-bold text-coral disabled:opacity-50"
          >
            {t("adminReview.rejectApplication")}
          </button>
        </div>
      )}

      <AdminReviewSection
        providerId={id}
        section="identity_documents"
        title={t("adminReview.identityDocuments")}
        canReview={canReview}
        submittedAt={submittedAt}
      >
        <span id="admin-provider-documents" className="block scroll-mt-20" />
        <IdentityDocuments provider={p} openDocument={openDocument} />
      </AdminReviewSection>
      <AdminReviewSection
        providerId={id}
        section="personal_details"
        title={t("adminReview.personalDetails")}
        canReview={canReview}
        submittedAt={submittedAt}
      >
        <span id="admin-onboarding-details" className="block scroll-mt-20" />
        <dl className="grid gap-3 sm:grid-cols-2">
          {[
            [t("admin.provider.city"), adminLocationLabel(p.city, currentLang(), t, payload.zones)],
            [t("admin.provider.rate"), t("adminReview.price", { amount: latin(p.hourly_rate) })],
            [
              t("admin.provider.experience"),
              t("adminReview.ageYears", { count: latin(p.years_experience) }),
            ],
            [t("adminReview.birthDate"), details?.date_of_birth],
            [
              t("adminReview.governorate"),
              adminLocationLabel(details?.governorate, currentLang(), t, payload.zones),
            ],
            [
              t("adminReview.area"),
              adminLocationLabel(details?.area, currentLang(), t, payload.zones),
            ],
            [t("adminReview.address"), details?.full_address],
            [t("adminReview.previousWork"), details?.previous_work],
          ].map(([label, value]) => (
            <div key={String(label)} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="break-words text-sm font-semibold">
                {value || t("adminReview.unavailable")}
              </dd>
            </div>
          ))}
        </dl>
      </AdminReviewSection>
      <AdminReviewSection
        providerId={id}
        section="references"
        title={t("adminReview.references")}
        canReview={canReview}
        submittedAt={submittedAt}
      >
        {payload?.references?.length ? (
          <ul className="space-y-2">
            {payload.references.map((reference) => (
              <li key={reference.id} className="rounded-xl border border-border p-3 text-sm">
                <p className="font-semibold">
                  {reference.full_name} · {reference.relationship}
                </p>
                <p dir="ltr" className="text-start text-xs">
                  {reference.phone}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("adminReview.noReferences")}</p>
        )}
      </AdminReviewSection>
      <AdminReviewSection
        providerId={id}
        section="services_prices"
        title={t("adminReview.servicesPrices")}
        canReview={canReview}
        submittedAt={submittedAt}
      >
        <span id="admin-provider-services" className="block scroll-mt-20" />
        <ProviderServices provider={p} />
      </AdminReviewSection>
      <AdminReviewSection
        providerId={id}
        section="babysitting_ages"
        title={t("adminReview.babysittingAges")}
        canReview={canReview}
        submittedAt={submittedAt}
      >
        {p.max_children_per_booking != null && (
          <p className="text-sm font-semibold">
            {t("adminReview.maxChildren", { count: latin(p.max_children_per_booking) })}
          </p>
        )}
        {ages.isError && (
          <AdminQueryError
            compact
            message={t("admin.providers.loadError")}
            error={ages.error}
            onRetry={() => ages.refetch()}
          />
        )}
        {ages.data?.length ? (
          <ul className="space-y-2">
            {ages.data.map((age: any) => (
              <li key={age.age_group_code} className="rounded-xl border border-border p-3 text-sm">
                {String(
                  t("pro.onboardingWizard.ageGroups." + age.age_group_code, age.age_group_code),
                )}{" "}
                · {t("adminReview.ageYears", { count: latin(age.years_experience) })}
              </li>
            ))}
          </ul>
        ) : (
          !ages.isLoading && (
            <p className="text-sm text-muted-foreground">{t("adminReview.noAgeGroups")}</p>
          )
        )}
      </AdminReviewSection>
      <AdminReviewSection
        providerId={id}
        section="teaching_groups"
        title={t("adminReview.teachingGroups")}
        canReview={canReview}
        submittedAt={submittedAt}
      >
        <TeachingCapabilityReviewQueue providerId={id} />
      </AdminReviewSection>
      <AdminReviewSection
        providerId={id}
        section="hours_zones"
        title={t("adminReview.hoursZones")}
        canReview={canReview}
        submittedAt={submittedAt}
      >
        <HoursAndZones providerId={id} zones={payload?.zones} />
      </AdminReviewSection>

      <details
        id="marketplace-eligibility"
        className="rounded-2xl border border-border bg-surface p-4"
      >
        <summary className="min-h-11 cursor-pointer text-sm font-bold">
          {t("admin.provider.approvalReview.technicalEligibility")}
        </summary>
        <EligibilityDetails providerId={id} />
      </details>
      {payload?.events?.length ? (
        <details className="rounded-2xl border border-border bg-surface p-4">
          <summary className="min-h-11 cursor-pointer text-sm font-bold">
            {t("admin.provider.approvalReview.auditHistory")}
          </summary>
          <ul className="mt-2 space-y-1 text-xs">
            {payload.events.slice(0, 12).map((event, index) => (
              <li key={index}>
                {event.action} · {event.new_status}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {p.onboarding_status === "APPROVED" && (
        <RequestUpdatedDetailsAction providerId={id} onboardingStatus={p.onboarding_status} />
      )}
      {p.is_verified && (
        <button
          type="button"
          onClick={() => setConfirmSuspend(true)}
          className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-coral px-4 text-sm font-bold text-coral"
        >
          <ShieldCheck className="h-4 w-4" />
          {p.is_active
            ? t("admin.provider.suspendProvider")
            : t("admin.provider.unsuspendProvider")}
        </button>
      )}
      {confirmAll && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="approve-all-title"
            className="w-full max-w-sm rounded-2xl bg-surface p-5"
          >
            <h2 id="approve-all-title" className="text-lg font-bold">
              {t("adminReview.approveAll")}
            </h2>
            <p className="mt-2 text-sm">{t("adminReview.approveAllConfirm")}</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmAll(false)}
                className="focus-ring min-h-11 flex-1 rounded-xl border border-border px-3 text-sm font-bold"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={approveAll.isPending}
                onClick={() =>
                  approveAll.mutate(id, {
                    onSuccess: () => {
                      setConfirmAll(false);
                      toast.success(t("adminReview.approveAllSuccess"));
                    },
                    onError: (error) =>
                      toast.error(
                        formatAdminActionErrorMessage(t, error, "adminReview.approveAllError"),
                      ),
                  })
                }
                className="focus-ring min-h-11 flex-1 rounded-xl bg-brand px-3 text-sm font-bold text-brand-foreground disabled:opacity-50"
              >
                {t("adminReview.approveAll")}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmReject && (
        <AdminReasonSheet
          title={t("adminReview.rejectApplication")}
          description={t("adminReview.rejectApplicationConfirm")}
          busy={action.isPending}
          onClose={() => setConfirmReject(false)}
          onConfirm={(reason) =>
            action.mutate(
              {
                providerId: id,
                action: "reject",
                reasonCode: "application_review",
                reasonPublic: reason,
              },
              {
                onSuccess: () => setConfirmReject(false),
                onError: (error) => toast.error(formatAdminActionErrorMessage(t, error)),
              },
            )
          }
        />
      )}
      {confirmSuspend && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="suspend-title"
            className="w-full max-w-sm rounded-2xl bg-surface p-5"
          >
            <h2 id="suspend-title" className="text-lg font-bold">
              {p.is_active
                ? t("admin.provider.suspendConfirmTitle")
                : t("admin.provider.unsuspendConfirmTitle")}
            </h2>
            <p className="mt-2 text-sm">
              {p.is_active
                ? t("admin.provider.suspendConfirmBody")
                : t("admin.provider.unsuspendConfirmBody")}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmSuspend(false)}
                className="focus-ring min-h-11 flex-1 rounded-xl border border-border px-3 text-sm font-bold"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={setActive.isPending}
                onClick={() =>
                  setActive.mutate(
                    { id, active: !p.is_active },
                    {
                      onSuccess: () => setConfirmSuspend(false),
                      onError: () => toast.error(t("common.somethingWentWrong")),
                    },
                  )
                }
                className="focus-ring min-h-11 flex-1 rounded-xl bg-coral px-3 text-sm font-bold text-coral-foreground disabled:opacity-50"
              >
                {t("common.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function AdminProviderRoute() {
  const { id } = Route.useParams();
  return <AdminProvider id={id} />;
}
